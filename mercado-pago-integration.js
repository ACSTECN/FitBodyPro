const PLAN_DETAILS = {
    starter: { title: 'Fitbory Starter', price: 1.00 },
    premium: { title: 'Fit Bory Premium', price: 1.00 }
};

const DEFAULT_CONFIG = {
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || 'COLOQUE_SEU_TOKEN_AQUI',
    baseUrl: process.env.APP_BASE_URL || 'https://fit-body-pro-one.vercel.app',
    webhookPath: '/api/webhook',
    successPath: '/success.html',
    failurePath: '/planos.html',
    pendingPath: '/planos.html'
};

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );
}

function getConfig(overrides = {}) {
    return {
        ...DEFAULT_CONFIG,
        ...overrides
    };
}

function getPlan(plan) {
    return PLAN_DETAILS[plan] || null;
}

async function mercadoPagoRequest(path, config, options = {}) {
    const response = await fetch(`https://api.mercadopago.com${path}`, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.accessToken}`,
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

function buildBackUrls(config, plan) {
    return {
        success: `${config.baseUrl}${config.successPath}?plan=${plan}`,
        failure: `${config.baseUrl}${config.failurePath}`,
        pending: `${config.baseUrl}${config.pendingPath}`
    };
}

async function createCheckoutPreference({ plan, config }) {
    const selectedPlan = getPlan(plan);

    if (!selectedPlan) {
        const error = new Error('Plano invalido');
        error.status = 400;
        throw error;
    }

    return mercadoPagoRequest('/checkout/preferences', config, {
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
            back_urls: buildBackUrls(config, plan),
            auto_return: 'approved',
            metadata: { plan }
        }
    });
}

async function createPixPayment({ plan, email, config }) {
    const selectedPlan = getPlan(plan);

    if (!selectedPlan) {
        const error = new Error('Plano invalido');
        error.status = 400;
        throw error;
    }

    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return mercadoPagoRequest('/v1/payments', config, {
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
            notification_url: `${config.baseUrl}${config.webhookPath}`
        }
    });
}

async function getPaymentById(paymentId, config) {
    if (!paymentId) {
        const error = new Error('ID do pagamento obrigatorio');
        error.status = 400;
        throw error;
    }

    return mercadoPagoRequest(`/v1/payments/${paymentId}`, config);
}

async function createPaymentHandler(req, res, overrides = {}) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Metodo nao permitido' });
    }

    const config = getConfig(overrides);

    try {
        const { plan, method, email } = req.body || {};

        if (!plan) {
            return res.status(400).json({ message: 'Plano obrigatorio' });
        }

        if (method === 'checkout-pro') {
            const preference = await createCheckoutPreference({ plan, config });

            return res.status(200).json({
                success: true,
                init_point: preference.init_point,
                sandbox_init_point: preference.sandbox_init_point
            });
        }

        const payment = await createPixPayment({ plan, email, config });

        return res.status(200).json({
            success: true,
            paymentId: payment.id,
            pixCode: payment.point_of_interaction?.transaction_data?.qr_code || null,
            qrCode: payment.point_of_interaction?.transaction_data?.qr_code_base64 || null,
            ticketUrl: payment.point_of_interaction?.transaction_data?.ticket_url || null,
            raw: payment
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            message: error.message || 'Erro interno do servidor',
            error: error.data || error.message
        });
    }
}

async function checkPaymentHandler(req, res, overrides = {}) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Metodo nao permitido' });
    }

    const config = getConfig(overrides);

    try {
        const { paymentId } = req.body || {};
        const payment = await getPaymentById(paymentId, config);

        return res.status(200).json({
            approved: payment.status === 'approved',
            status: payment.status,
            data: payment
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            message: error.message || 'Erro interno do servidor',
            error: error.data || error.message
        });
    }
}

async function webhookHandler(req, res, overrides = {}) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Metodo nao permitido' });
    }

    const config = getConfig(overrides);

    try {
        const { type, data } = req.body || {};

        if (type === 'payment' && data?.id) {
            const payment = await getPaymentById(data.id, config);

            if (payment.status === 'approved') {
                console.log('Pagamento aprovado via webhook:', payment.id);
            }
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(error.status || 500).json({
            message: error.message || 'Erro interno do servidor',
            error: error.data || error.message
        });
    }
}

module.exports = {
    PLAN_DETAILS,
    DEFAULT_CONFIG,
    setCorsHeaders,
    getConfig,
    getPlan,
    createCheckoutPreference,
    createPixPayment,
    getPaymentById,
    createPaymentHandler,
    checkPaymentHandler,
    webhookHandler
};

/*
Exemplo de uso em outro projeto:

const {
    createPaymentHandler,
    checkPaymentHandler,
    webhookHandler
} = require('./mercado-pago-integration');

module.exports = async function handler(req, res) {
    return createPaymentHandler(req, res, {
        accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN,
        baseUrl: 'https://seu-dominio.com'
    });
};
*/
