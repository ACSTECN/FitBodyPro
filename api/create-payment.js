const PLAN_DETAILS = {
    starter: { title: 'Fitbory Starter', price: 0.5 },
    premium: { title: 'Fit Bory Premium', price: 0.5 }
};

const MP_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;

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
    if (existing?.id) return existing;
    return createCustomer(customerInput);
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
        installments
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
        identificationNumber
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
    } catch (error) {
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
    const billingDate = new Date().toISOString().split('T')[0];
    const payment = await mercadoPagoRequest('/v1/payments', {
        method: 'POST',
        headers: {
            'X-Idempotency-Key': `${Date.now()}-${Math.random().toString(36).slice(2)}`
        },
        body: {
            transaction_amount: selectedPlan.price,
            token,
            description: selectedPlan.title,
            installments: Number(installments) || 1,
            payment_method_id: paymentMethodId,
            issuer_id: issuerId || undefined,
            payer: {
                type: 'customer',
                id: customer.id,
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
                providerSubscriptionId: subscriptionId,
                providerCardId: savedCard.id
            },
            point_of_interaction: {
                type: 'SUBSCRIPTIONS',
                transaction_data: {
                    first_time_use: true,
                    subscription_id: subscriptionId,
                    subscription_sequence: {
                        number: 1,
                        total: null
                    },
                    invoice_period: {
                        period: 1,
                        type: 'monthly'
                    },
                    billing_date: billingDate,
                    user_present: true
                }
            }
        }
    });

    return {
        payment,
        customer,
        savedCard,
        subscriptionId
    };
}

module.exports = async function handler(req, res) {
    setCorsHeaders(res);

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
            await createCardPayment(req.body);

        const providerCardId = savedCard.id;
        const cardLastFour = savedCard.last_four_digits || payment.card?.last_four_digits || null;
        const cardBrand =
            savedCard.payment_method?.id ||
            payment.payment_method_id ||
            payment.payment_method?.id ||
            null;

        if (!providerCardId) {
            return res.status(400).json({
                success: false,
                approved: false,
                message: 'Pagamento bloqueado: providerCardId não foi gerado.',
                recurringReady: false
            });
        }

        return res.status(200).json({
            version: 'save-card-first-no-provider-card-no-payment-v1',
            success: payment.status === 'approved' || payment.status === 'in_process',
            approved: payment.status === 'approved',
            paymentId: payment.id,
            status: payment.status,
            statusDetail: payment.status_detail,
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