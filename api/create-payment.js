const PLAN_DETAILS = {
    starter: { title: 'Fitbory Starter', price: 5.0 },
    premium: { title: 'Fit Bory Premium', price: 5.0 }
};

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_API_BASE_URL =
    process.env.ASAAS_API_BASE_URL ||
    (String(process.env.ASAAS_ENV || '').toLowerCase() === 'sandbox'
        ? 'https://api-sandbox.asaas.com/v3'
        : 'https://api.asaas.com/v3');

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function cleanDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function sanitizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function sanitizeName(value) {
    return String(value || '').trim();
}

function getSelectedPlan(plan) {
    return PLAN_DETAILS[plan] || null;
}

function formatDate(date) {
    return new Date(date).toISOString().slice(0, 10);
}

function addMonths(date, months) {
    const nextDate = new Date(date);
    nextDate.setMonth(nextDate.getMonth() + months);
    return nextDate;
}

function getRemoteIp(req) {
    const forwardedFor = req.headers['x-forwarded-for'];

    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
        return forwardedFor.split(',')[0].trim();
    }

    return (
        req.headers['x-real-ip'] ||
        req.socket?.remoteAddress ||
        req.connection?.remoteAddress ||
        null
    );
}

function inferCardBrand(cardNumber) {
    const digits = cleanDigits(cardNumber);

    if (/^4/.test(digits)) return 'visa';
    if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard';
    if (/^3[47]/.test(digits)) return 'amex';
    if (/^(4011|4312|4389)/.test(digits)) return 'elo';

    return 'credit_card';
}

function buildAsaasErrorMessage(data, fallbackMessage) {
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
        return data.errors
            .map((item) => item.description || item.code)
            .filter(Boolean)
            .join(' | ');
    }

    return data?.message || fallbackMessage;
}

async function asaasRequest(path, options = {}) {
    if (!ASAAS_API_KEY) {
        const error = new Error('ASAAS_API_KEY não configurada.');
        error.status = 500;
        throw error;
    }

    const response = await fetch(`${ASAAS_API_BASE_URL}${path}`, {
        method: options.method || 'GET',
        headers: {
            accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'FitboryPro/1.0.0',
            access_token: ASAAS_API_KEY,
            ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const responseText = await response.text();
    const data = responseText ? JSON.parse(responseText) : null;

    if (!response.ok) {
        const error = new Error(buildAsaasErrorMessage(data, 'Erro ao comunicar com o Asaas.'));
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

async function findCustomer({ email, cpfCnpj, externalReference }) {
    const query = new URLSearchParams({ limit: '1' });

    if (cpfCnpj) {
        query.set('cpfCnpj', cpfCnpj);
    } else if (email) {
        query.set('email', email);
    } else if (externalReference) {
        query.set('externalReference', externalReference);
    }

    const data = await asaasRequest(`/customers?${query.toString()}`);
    return Array.isArray(data?.data) && data.data.length > 0 ? data.data[0] : null;
}

function buildCustomerPayload({
    fullName,
    email,
    phone,
    cpfCnpj,
    zipCode,
    streetName,
    streetNumber,
    neighborhood,
    externalReference
}) {
    const mobilePhone = cleanDigits(phone);

    return {
        name: sanitizeName(fullName),
        cpfCnpj,
        email,
        mobilePhone: mobilePhone || undefined,
        phone: mobilePhone || undefined,
        postalCode: zipCode || undefined,
        address: sanitizeName(streetName) || undefined,
        addressNumber: sanitizeName(streetNumber) || undefined,
        province: sanitizeName(neighborhood) || undefined,
        externalReference,
        notificationDisabled: true
    };
}

async function ensureCustomer(customerData) {
    const existingCustomer = await findCustomer(customerData);
    const payload = buildCustomerPayload(customerData);

    if (existingCustomer?.id) {
        return asaasRequest(`/customers/${existingCustomer.id}`, {
            method: 'PUT',
            body: payload
        });
    }

    return asaasRequest('/customers', {
        method: 'POST',
        body: payload
    });
}

function buildCreditCardPayload(cardData) {
    return {
        holderName: sanitizeName(cardData.cardholderName),
        number: cleanDigits(cardData.cardNumber),
        expiryMonth: cleanDigits(cardData.expiryMonth).slice(0, 2),
        expiryYear: cleanDigits(cardData.expiryYear).slice(-4),
        ccv: cleanDigits(cardData.cvv).slice(0, 4)
    };
}

function buildCreditCardHolderInfo(cardData) {
    const phoneDigits = cleanDigits(cardData.phone);

    return {
        name: sanitizeName(cardData.cardholderName),
        email: sanitizeEmail(cardData.email),
        cpfCnpj: cleanDigits(cardData.cpfCnpj),
        postalCode: cleanDigits(cardData.zipCode),
        addressNumber: sanitizeName(cardData.streetNumber),
        addressComplement: sanitizeName(cardData.addressComplement) || undefined,
        phone: phoneDigits || undefined,
        mobilePhone: phoneDigits || undefined
    };
}

function getCreditCardTokenFromResponse(data) {
    return (
        data?.creditCardToken ||
        data?.token ||
        data?.creditCard?.creditCardToken ||
        null
    );
}

async function tokenizeCreditCard({
    customerId,
    reqBody,
    remoteIp,
    creditCardHolderInfo
}) {
    const tokenization = await asaasRequest('/creditCard/tokenizeCreditCard', {
        method: 'POST',
        body: {
            customer: customerId,
            creditCard: buildCreditCardPayload(reqBody),
            creditCardHolderInfo,
            remoteIp
        }
    });

    const creditCardToken = getCreditCardTokenFromResponse(tokenization);

    if (!creditCardToken) {
        const error = new Error(
            'O Asaas não retornou o token do cartão. Verifique se a tokenização de cartão está habilitada na conta.'
        );
        error.status = 400;
        error.data = tokenization;
        throw error;
    }

    return {
        tokenization,
        creditCardToken
    };
}

function buildImmediatePaymentPayload({
    customerId,
    selectedPlan,
    externalReference,
    reqBody,
    remoteIp,
    creditCardToken,
    creditCardHolderInfo
}) {
    const payload = {
        customer: customerId,
        billingType: 'CREDIT_CARD',
        value: selectedPlan.price,
        dueDate: formatDate(new Date()),
        description: selectedPlan.title,
        externalReference,
        remoteIp
    };

    if (creditCardToken) {
        payload.creditCardToken = creditCardToken;
    } else {
        payload.creditCard = buildCreditCardPayload(reqBody);
        payload.creditCardHolderInfo =
            creditCardHolderInfo || buildCreditCardHolderInfo(reqBody);
    }

    return payload;
}

function buildSubscriptionPayload({
    customerId,
    selectedPlan,
    externalReference,
    reqBody,
    remoteIp,
    creditCardToken
}) {
    const payload = {
        customer: customerId,
        billingType: 'CREDIT_CARD',
        value: selectedPlan.price,
        nextDueDate: formatDate(addMonths(new Date(), 1)),
        cycle: 'MONTHLY',
        description: `${selectedPlan.title} - assinatura mensal`,
        externalReference,
        remoteIp
    };

    if (creditCardToken) {
        payload.creditCardToken = creditCardToken;
    } else {
        payload.creditCard = buildCreditCardPayload(reqBody);
        payload.creditCardHolderInfo = buildCreditCardHolderInfo(reqBody);
    }

    return payload;
}

function isApprovedAsaasStatus(status) {
    return ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(String(status || '').toUpperCase());
}

function isManualReviewStatus(status) {
    return String(status || '').toUpperCase() === 'AWAITING_RISK_ANALYSIS';
}

function buildStatusMessage(status) {
    const normalizedStatus = String(status || '').toUpperCase();

    if (isApprovedAsaasStatus(normalizedStatus)) {
        return 'Pagamento aprovado no Asaas.';
    }

    if (isManualReviewStatus(normalizedStatus)) {
        return 'O Asaas colocou essa tentativa em análise de risco. Aguarde a validação ou tente outro cartão.';
    }

    return `Pagamento retornou com status ${normalizedStatus || 'desconhecido'}.`;
}

async function createCardPayment(req, reqBody) {
    const {
        plan,
        email,
        phone,
        zipCode,
        streetName,
        streetNumber,
        neighborhood,
        cardholderName,
        cardNumber,
        expiryMonth,
        expiryYear,
        cvv,
        cpfCnpj
    } = reqBody;

    if (
        !plan ||
        !email ||
        !phone ||
        !zipCode ||
        !streetNumber ||
        !cardholderName ||
        !cardNumber ||
        !expiryMonth ||
        !expiryYear ||
        !cvv ||
        !cpfCnpj
    ) {
        const error = new Error('Dados do cartão incompletos para pagamento no Asaas.');
        error.status = 400;
        throw error;
    }

    const selectedPlan = getSelectedPlan(plan);

    if (!selectedPlan) {
        const error = new Error('Plano inválido.');
        error.status = 400;
        throw error;
    }

    const sanitizedEmail = sanitizeEmail(email);
    const sanitizedCpfCnpj = cleanDigits(cpfCnpj);
    const customerReference = `fitbory:${sanitizedEmail}:${sanitizedCpfCnpj}`;
    const chargeReference = `fitbory-charge:${plan}:${Date.now()}`;
    const subscriptionReference = `fitbory-subscription:${plan}:${Date.now()}`;
    const remoteIp = getRemoteIp(req);
    const creditCardHolderInfo = buildCreditCardHolderInfo({
        ...reqBody,
        email: sanitizedEmail,
        cpfCnpj: sanitizedCpfCnpj
    });

    if (!remoteIp) {
        const error = new Error('Não foi possível identificar o IP do comprador para o Asaas.');
        error.status = 400;
        throw error;
    }

    const customer = await ensureCustomer({
        fullName: cardholderName,
        email: sanitizedEmail,
        phone,
        cpfCnpj: sanitizedCpfCnpj,
        zipCode: cleanDigits(zipCode),
        streetName,
        streetNumber,
        neighborhood,
        externalReference: customerReference
    });

    const { tokenization, creditCardToken: tokenizedCreditCardToken } =
        await tokenizeCreditCard({
            customerId: customer.id,
            reqBody: {
                ...reqBody,
                email: sanitizedEmail,
                cpfCnpj: sanitizedCpfCnpj
            },
            remoteIp,
            creditCardHolderInfo
        });

    const payment = await asaasRequest('/payments', {
        method: 'POST',
        body: buildImmediatePaymentPayload({
            customerId: customer.id,
            selectedPlan,
            externalReference: chargeReference,
            reqBody: {
                ...reqBody,
                email: sanitizedEmail,
                cpfCnpj: sanitizedCpfCnpj
            },
            remoteIp,
            creditCardToken: tokenizedCreditCardToken,
            creditCardHolderInfo
        })
    });

    if (!isApprovedAsaasStatus(payment?.status)) {
        return {
            customer,
            payment,
            tokenization,
            subscription: null,
            remoteIp,
            creditCardHolderInfo,
            creditCardToken:
                getCreditCardTokenFromResponse(payment) ||
                tokenizedCreditCardToken
        };
    }

    const creditCardToken =
        getCreditCardTokenFromResponse(payment) || tokenizedCreditCardToken;

    const subscription = await asaasRequest('/subscriptions', {
        method: 'POST',
        body: buildSubscriptionPayload({
            customerId: customer.id,
            selectedPlan,
            externalReference: subscriptionReference,
            reqBody: {
                ...reqBody,
                email: sanitizedEmail,
                cpfCnpj: sanitizedCpfCnpj
            },
            remoteIp,
            creditCardToken
        })
    });

    return {
        customer,
        payment,
        tokenization,
        subscription,
        remoteIp,
        creditCardHolderInfo,
        creditCardToken:
            creditCardToken ||
            getCreditCardTokenFromResponse(subscription) ||
            null
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
                message: 'Plano obrigatório.'
            });
        }

        if (method !== 'card') {
            return res.status(400).json({
                success: false,
                message: 'Este fluxo aceita apenas pagamento com cartão.'
            });
        }

        const {
            customer,
            payment,
            subscription,
            creditCardToken,
            remoteIp,
            creditCardHolderInfo
        } = await createCardPayment(req, req.body);
        const approved = isApprovedAsaasStatus(payment?.status);
        const manualReview = isManualReviewStatus(payment?.status);
        const cardLastFour = cleanDigits(req.body.cardNumber).slice(-4) || null;
        const cardBrand =
            payment?.creditCard?.creditCardBrand ||
            payment?.creditCardBrand ||
            inferCardBrand(req.body.cardNumber);

        return res.status(200).json({
            version: 'asaas-first-charge-plus-subscription-v1',
            success: approved,
            approved,
            requiresAction: !approved,
            requiresManualReview: manualReview,
            paymentId: payment?.id || null,
            status: payment?.status || null,
            statusDetail: payment?.status || null,
            message: buildStatusMessage(payment?.status),
            recurringReady: Boolean(customer?.id && subscription?.id),
            recurringData: {
                paymentStatus: payment?.status || null,
                paymentAmount: payment?.value ?? getSelectedPlan(plan)?.price ?? null,
                paymentCurrency: 'BRL',
                providerReference: payment?.invoiceNumber || payment?.externalReference || payment?.id || null,
                paymentDescription: payment?.description || getSelectedPlan(plan)?.title || null,
                providerCustomerId: customer?.id || null,
                providerCardId: creditCardToken || subscription?.id || null,
                providerPaymentMethodToken: creditCardToken || null,
                paymentMethodId: 'credit_card',
                issuerId: cardBrand,
                cardBrand,
                cardLastFour,
                firstPaymentProviderPaymentId: payment?.id || null,
                remoteIp: remoteIp || null,
                creditCardHolderInfo: creditCardHolderInfo || null,
                providerSubscriptionId: subscription?.id || null,
                paymentRawPayload: {
                    customer,
                    payment,
                    tokenization,
                    subscription,
                    creditCardToken: creditCardToken || null,
                    remoteIp: remoteIp || null,
                    creditCardHolderInfo: creditCardHolderInfo || null
                }
            }
        });
    } catch (error) {
        console.error('Asaas Payment Error:', error);

        return res.status(error.status || 500).json({
            success: false,
            approved: false,
            recurringReady: false,
            message: error.message || 'Erro interno do servidor.',
            error: error.data || error.message
        });
    }
};
