const PLAN_DETAILS = {
    starter: { title: 'Fitbory Starter', price: 4.0 },
    premium: { title: 'Fit Bory Premium', price: 4.0 }
};

const MP_ACCESS_TOKEN =
    process.env.MERCADO_PAGO_ACCESS_TOKEN ||
    'APP_USR-1299466235883241-102116-24fec28f28914fa1efa5da0c7d739d40-231219998';

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://fit-body-pro-one.vercel.app';

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );
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
    if (Array.isArray(data.results) && data.results.length > 0) {
        return data.results[0];
    }
    return null;
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
    if (existing?.id) {
        return existing;
    }
    return createCustomer(customerInput);
}

async function createPixPayment(plan, email) {
    const selectedPlan = getSelectedPlan(plan);
    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return mercadoPagoRequest('/v1/payments', {
        method: 'POST',
        headers: {
            'X-Idempotency-Key': idempotencyKey
        },
        body: {
            transaction_amount: selectedPlan.price,
            description: selectedPlan.title,
            payment_method_id: 'pix',
            payer: {
                email: email || 'test@test.com',
                first_name: 'Cliente',
                last_name: 'Fitbory'
            },
            metadata: { plan },
            notification_url: `${APP_BASE_URL}/api/webhook`
        }
    });
}

async function createCheckoutPreference(plan) {
    const selectedPlan = getSelectedPlan(plan);

    return mercadoPagoRequest('/checkout/preferences', {
        method: 'POST',
        body: {
            items: [
                {
                    title: selectedPlan.title,
                    description: selectedPlan.title,
                    quantity: 1,
                    currency_id: 'BRL',
                    unit_price: selectedPlan.price
                }
            ],
            back_urls: {
                success: `${APP_BASE_URL}/success.html?plan=${plan}`,
                failure: `${APP_BASE_URL}/planos.html`,
                pending: `${APP_BASE_URL}/planos.html`
            },
            auto_return: 'approved',
            metadata: { plan }
        }
    });
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

    if (!token || !email || !paymentMethodId) {
        const error = new Error('Dados do cartao incompletos para pagamento recorrente.');
        error.status = 400;
        throw error;
    }

    const selectedPlan = getSelectedPlan(plan);
    const customer = await ensureCustomer({
        email,
        fullName: cardholderName,
        identificationType,
        identificationNumber
    });
    const { firstName, lastName } = splitFullName(cardholderName);
    const subscriptionId = buildRecurringSubscriptionId(plan);
    const billingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const payment = await mercadoPagoRequest('/v1/payments', {
        method: 'POST',
        headers: {
            'X-Idempotency-Key': idempotencyKey
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
                source: 'landing-card-recurring'
            },
            notification_url: `${APP_BASE_URL}/api/webhook`,
            point_of_interaction: {
                type: 'SUBSCRIPTIONS',
                transaction_data: {
                    first_time_use: true,
                    subscription_id: subscriptionId,
                    subscription_sequence: {
                        number: 1,
                        total: 12
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

    let savedCard = null;
    let cardSaveError = null;

    try {
        savedCard = await mercadoPagoRequest(`/v1/customers/${customer.id}/cards`, {
            method: 'POST',
            body: {
                token,
                issuer_id: issuerId || undefined,
                payment_method_id: paymentMethodId
            }
        });
    } catch (error) {
        cardSaveError = error.data || error.message;
        console.error('Erro ao salvar cartao no customer do Mercado Pago:', cardSaveError);
    }

    return {
        payment,
        customer,
        savedCard,
        subscriptionId,
        cardSaveError
    };
}

module.exports = async function handler(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Método não permitido' });
    }

    try {
        const { plan, method, email } = req.body || {};

        if (!plan) {
            return res.status(400).json({ message: 'Plano obrigatório' });
        }

        const selectedPlan = getSelectedPlan(plan);
        if (!selectedPlan) {
            return res.status(400).json({ message: 'Plano inválido' });
        }

        if (method === 'checkout-pro') {
            const preference = await createCheckoutPreference(plan);
            return res.status(200).json({
                success: true,
                init_point: preference.init_point,
                sandbox_init_point: preference.sandbox_init_point
            });
        }

        if (method === 'card') {
            const { payment, customer, savedCard, subscriptionId, cardSaveError } = await createCardPayment(
                req.body
            );

            return res.status(200).json({
                success: payment.status === 'approved' || payment.status === 'in_process',
                approved: payment.status === 'approved',
                paymentId: payment.id,
                status: payment.status,
                statusDetail: payment.status_detail,
                recurringReady: Boolean(customer?.id && savedCard?.id),
                cardSaveError,
                recurringData: {
                    paymentAmount: payment.transaction_amount,
                    paymentCurrency: payment.currency_id,
                    providerReference: payment.order?.id || payment.external_reference || payment.id,
                    paymentDescription: payment.description,
                    providerCustomerId: customer?.id,
                    providerCardId: savedCard?.id || null,
                    paymentMethodId: payment.payment_method_id || paymentMethodId,
                    issuerId: savedCard?.issuer?.id || payment.issuer_id || payment.issuer?.id || null,
                    cardBrand: savedCard?.payment_method?.id || payment.payment_method_id || null,
                    cardLastFour:
                        savedCard?.last_four_digits || payment.card?.last_four_digits || null,
                    firstPaymentProviderPaymentId: payment.id,
                    providerSubscriptionId: subscriptionId,
                    paymentRawPayload: {
                        payment,
                        customer,
                        savedCard,
                        cardSaveError
                    }
                }
            });
        }

        const payment = await createPixPayment(plan, email);

        return res.status(200).json({
            success: true,
            paymentId: payment.id,
            pixCode: payment.point_of_interaction?.transaction_data?.qr_code || null,
            qrCode: payment.point_of_interaction?.transaction_data?.qr_code_base64 || null,
            ticketUrl: payment.point_of_interaction?.transaction_data?.ticket_url || null,
            raw: payment
        });
    } catch (error) {
        console.error('Payment Error:', error);
        return res.status(error.status || 500).json({
            message: error.message || 'Erro interno do servidor',
            error: error.data || error.message
        });
    }
};
