const fs = require('fs');

const PLAN_DETAILS = {
    starter: { title: 'Fitbory Starter', price: 5.00 },
    premium: { title: 'Fit Bory Premium', price: 3.0 }
};

const MP_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;
const DEBUG_ENV_PATH = '.dbg/manual-review-recurring.env';
const DEBUG_FALLBACK_URL = 'http://127.0.0.1:7777/event';
const DEBUG_FALLBACK_SESSION = 'manual-review-recurring';

function getDebugConfig() {
    try {
        const envContent = fs.readFileSync(DEBUG_ENV_PATH, 'utf8');
        const debugServerUrl =
            envContent.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || DEBUG_FALLBACK_URL;
        const debugSessionId =
            envContent.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || DEBUG_FALLBACK_SESSION;

        return {
            debugServerUrl,
            debugSessionId
        };
    } catch (error) {
        return {
            debugServerUrl: DEBUG_FALLBACK_URL,
            debugSessionId: DEBUG_FALLBACK_SESSION
        };
    }
}

function maskEmail(email) {
    const [localPart, domainPart] = String(email || '').split('@');

    if (!localPart || !domainPart) {
        return null;
    }

    const visiblePrefix = localPart.slice(0, 2);
    return `${visiblePrefix}***@${domainPart}`;
}

function sendDebugEvent({ runId = 'pre-fix', hypothesisId, location, msg, data = {}, traceId }) {
    const { debugServerUrl, debugSessionId } = getDebugConfig();

    fetch(debugServerUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            sessionId: debugSessionId,
            runId,
            hypothesisId,
            location,
            msg,
            data,
            traceId,
            ts: Date.now()
        })
    }).catch(() => {});
}

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function splitFullName(fullName) {
    const parts = String(fullName || 'Cliente Fitbory').trim().split(/\s+/).filter(Boolean);
    const firstName = parts.shift() || 'Cliente';
    const lastName = parts.join(' ') || 'Fitbory';
    return { firstName, lastName };
}

function cleanDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function getSelectedPlan(plan) {
    return PLAN_DETAILS[plan] || null;
}

function buildRecurringSubscriptionId(plan) {
    return `fitbory-${plan}-${Date.now()}`;
}

async function mercadoPagoRequest(path, options = {}) {
    if (!MP_ACCESS_TOKEN) {
        const error = new Error('MERCADO_PAGO_ACCESS_TOKEN não configurado.');
        error.status = 500;
        throw error;
    }

    const response = await fetch(`https://api.mercadopago.com${path}`, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
            ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await response.json();

    if (!response.ok) {
        const error = new Error(data.message || 'Erro ao comunicar com o Mercado Pago');
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

async function findCustomerByEmail(email) {
    const data = await mercadoPagoRequest(`/v1/customers/search?email=${encodeURIComponent(email)}`);
    return Array.isArray(data.results) && data.results.length > 0 ? data.results[0] : null;
}

async function createCustomer({ email, fullName, identificationType, identificationNumber }) {
    const { firstName, lastName } = splitFullName(fullName);
    const cleanedDocument = cleanDigits(identificationNumber);

    return mercadoPagoRequest('/v1/customers', {
        method: 'POST',
        body: {
            email,
            first_name: firstName,
            last_name: lastName,
            identification:
                cleanedDocument && identificationType
                    ? {
                          type: identificationType,
                          number: cleanedDocument
                      }
                    : undefined
        }
    });
}

async function ensureCustomer(customerInput) {
    const existing = await findCustomerByEmail(customerInput.email);
    const traceId = customerInput.traceId;

    // #region debug-point B:customer-search
    sendDebugEvent({
        hypothesisId: 'B',
        location: 'api/create-payment.js:ensureCustomer',
        msg: '[DEBUG] Resultado da busca de customer por email',
        traceId,
        data: {
            email: maskEmail(customerInput.email),
            foundExistingCustomer: Boolean(existing?.id),
            existingCustomerId: existing?.id || null
        }
    });
    // #endregion

    if (existing?.id) return existing;

    const createdCustomer = await createCustomer(customerInput);

    // #region debug-point B:customer-create
    sendDebugEvent({
        hypothesisId: 'B',
        location: 'api/create-payment.js:ensureCustomer',
        msg: '[DEBUG] Customer criado no Mercado Pago',
        traceId,
        data: {
            email: maskEmail(customerInput.email),
            createdCustomerId: createdCustomer?.id || null
        }
    });
    // #endregion

    return createdCustomer;
}

async function createCardPayment(reqBody) {
    const {
        plan,
        token,
        email,
        cardholderName,
        identificationType,
        identificationNumber,
        paymentMethodId,
        issuerId,
        installments,
        traceId
    } = reqBody;

    if (!plan || !token || !email || !paymentMethodId) {
        const error = new Error('Dados do cartão incompletos para pagamento recorrente.');
        error.status = 400;
        throw error;
    }

    const selectedPlan = getSelectedPlan(plan);

    if (!selectedPlan) {
        const error = new Error('Plano inválido.');
        error.status = 400;
        throw error;
    }

    const customer = await ensureCustomer({
        email,
        fullName: cardholderName,
        identificationType,
        identificationNumber,
        traceId
    });

    const subscriptionId = buildRecurringSubscriptionId(plan);

    let savedCard;

    try {
        savedCard = await mercadoPagoRequest(`/v1/customers/${customer.id}/cards`, {
            method: 'POST',
            body: {
                token
            }
        });

        // #region debug-point C:saved-card
        sendDebugEvent({
            hypothesisId: 'C',
            location: 'api/create-payment.js:createCardPayment',
            msg: '[DEBUG] Cartao salvo no customer do Mercado Pago',
            traceId,
            data: {
                customerId: customer?.id || null,
                providerCardId: savedCard?.id || null,
                issuerId: savedCard?.issuer?.id || null,
                paymentMethodId: savedCard?.payment_method?.id || null,
                lastFour: savedCard?.last_four_digits || null
            }
        });
        // #endregion
    } catch (error) {
        // #region debug-point C:saved-card-error
        sendDebugEvent({
            hypothesisId: 'C',
            location: 'api/create-payment.js:createCardPayment',
            msg: '[DEBUG] Falha ao salvar cartao no customer do Mercado Pago',
            traceId,
            data: {
                customerId: customer?.id || null,
                errorStatus: error?.status || null,
                mpMessage: error?.data?.message || error?.data?.error || error?.message || null,
                mpCause: error?.data?.cause || null
            }
        });
        // #endregion

        const mpMessage =
            error.data?.message ||
            error.data?.error ||
            error.message ||
            'Não foi possível salvar o cartão.';

        const customError = new Error(`Cartão não foi salvo no Mercado Pago: ${mpMessage}`);
        customError.status = 400;
        customError.data = error.data || error.message;
        throw customError;
    }

    if (!savedCard?.id) {
        const error = new Error('Cartão não retornou providerCardId. Pagamento não será cobrado.');
        error.status = 400;
        error.data = { savedCard };
        throw error;
    }

    const { firstName, lastName } = splitFullName(cardholderName);
    const paymentPayload = {
        transaction_amount: selectedPlan.price,
        token,
        description: selectedPlan.title,
        external_reference: subscriptionId,
        installments: Number(installments) || 1,
        payment_method_id: paymentMethodId,
        issuer_id: issuerId || undefined,
        payer: {
            email,
            first_name: firstName,
            last_name: lastName,
            identification:
                identificationType && identificationNumber
                    ? {
                        type: identificationType,
                        number: cleanDigits(identificationNumber)
                    }
                    : undefined
        },
        metadata: {
            plan,
            billingCycle: 'monthly',
            source: 'landing-card-recurring',
            providerCustomerId: customer.id,
            providerSubscriptionId: subscriptionId,
            providerCardId: savedCard.id
        }
    };

    // #region debug-point D:payment-payload
    sendDebugEvent({
        hypothesisId: 'D',
        location: 'api/create-payment.js:createCardPayment',
        msg: '[DEBUG] Enviando primeira cobranca para o Mercado Pago',
        traceId,
        data: {
            amount: paymentPayload.transaction_amount,
            plan,
            paymentMethodId: paymentPayload.payment_method_id,
            issuerId: paymentPayload.issuer_id || null,
            installments: paymentPayload.installments,
            hasIdentification: Boolean(paymentPayload.payer.identification?.number),
            customerId: customer?.id || null,
            providerCardId: savedCard?.id || null,
            subscriptionId
        }
    });
    // #endregion

    const payment = await mercadoPagoRequest('/v1/payments', {
        method: 'POST',
        headers: {
            'X-Idempotency-Key': `${Date.now()}-${Math.random().toString(36).slice(2)}`
        },
        body: paymentPayload
    });

    // #region debug-point E:payment-response
    sendDebugEvent({
        hypothesisId: 'E',
        location: 'api/create-payment.js:createCardPayment',
        msg: '[DEBUG] Resposta da primeira cobranca do Mercado Pago',
        traceId,
        data: {
            paymentId: payment?.id || null,
            status: payment?.status || null,
            statusDetail: payment?.status_detail || null,
            paymentTypeId: payment?.payment_type_id || null,
            paymentMethodId: payment?.payment_method_id || payment?.payment_method?.id || null,
            issuerId: payment?.issuer_id || payment?.issuer?.id || null,
            merchantOrderId: payment?.order?.id || null,
            hasPointOfInteraction: Boolean(payment?.point_of_interaction),
            payerId: payment?.payer?.id || null
        }
    });
    // #endregion

    return {
        payment,
        customer,
        savedCard,
        subscriptionId
    };
}

module.exports = async function handler(req, res) {
    setCorsHeaders(res);
    const traceId = `mp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            message: 'Método não permitido'
        });
    }

    try {
        const { plan, method } = req.body || {};

        // #region debug-point A:handler-start
        sendDebugEvent({
            hypothesisId: 'A',
            location: 'api/create-payment.js:handler',
            msg: '[DEBUG] Requisicao recebida para create-payment',
            traceId,
            data: {
                plan: plan || null,
                method: method || null,
                email: maskEmail(req.body?.email),
                paymentMethodId: req.body?.paymentMethodId || null,
                issuerId: req.body?.issuerId || null
            }
        });
        // #endregion

        if (!plan) {
            return res.status(400).json({
                success: false,
                message: 'Plano obrigatório'
            });
        }

        if (method !== 'card') {
            return res.status(400).json({
                success: false,
                message: 'Este fluxo aceita apenas pagamento com cartão.'
            });
        }

        const { payment, customer, savedCard, subscriptionId } =
            await createCardPayment({
                ...req.body,
                traceId
            });

        const providerCardId = savedCard.id;
        const cardLastFour = savedCard.last_four_digits || payment.card?.last_four_digits || null;
        const cardBrand =
            savedCard.payment_method?.id ||
            payment.payment_method_id ||
            payment.payment_method?.id ||
            null;
        const isApproved = payment.status === 'approved';
        const isManualReview = payment.status === 'in_process' && payment.status_detail === 'pending_review_manual';
        const statusMessage = isApproved
            ? 'Pagamento aprovado.'
            : isManualReview
                ? 'O Mercado Pago colocou essa tentativa em analise manual. Tente outro cartao ou aguarde a analise.'
                : `Pagamento retornou com status ${payment.status}. ${payment.status_detail || ''}`.trim();

        if (!providerCardId) {
            return res.status(400).json({
                success: false,
                approved: false,
                message: 'Pagamento bloqueado: providerCardId não foi gerado.',
                recurringReady: false
            });
        }

        return res.status(200).json({
            version: 'save-card-first-standard-charge-v2',
            success: isApproved,
            approved: isApproved,
            requiresAction: !isApproved,
            requiresManualReview: isManualReview,
            paymentId: payment.id,
            status: payment.status,
            statusDetail: payment.status_detail,
            message: statusMessage,
            recurringReady: Boolean(customer?.id && providerCardId),
            recurringData: {
                paymentAmount: payment.transaction_amount,
                paymentCurrency: payment.currency_id,
                providerReference: payment.order?.id || payment.external_reference || payment.id,
                paymentDescription: payment.description,

                providerCustomerId: customer.id,
                providerCardId,
                paymentMethodId: payment.payment_method_id || req.body.paymentMethodId,
                issuerId: savedCard.issuer?.id || payment.issuer_id || payment.issuer?.id || null,
                cardBrand,
                cardLastFour,
                firstPaymentProviderPaymentId: payment.id,
                providerSubscriptionId: subscriptionId,

                paymentRawPayload: {
                    payment,
                    customer,
                    savedCard
                }
            }
        });
    } catch (error) {
        // #region debug-point F:handler-error
        sendDebugEvent({
            hypothesisId: 'F',
            location: 'api/create-payment.js:handler',
            msg: '[DEBUG] create-payment falhou',
            traceId,
            data: {
                errorStatus: error?.status || null,
                errorMessage: error?.message || null,
                mpMessage: error?.data?.message || error?.data?.error || null,
                mpCause: error?.data?.cause || null
            }
        });
        // #endregion

        console.error('Payment Error:', error);

        return res.status(error.status || 500).json({
            success: false,
            approved: false,
            recurringReady: false,
            message: error.message || 'Erro interno do servidor',
            error: error.data || error.message
        });
    }
};
