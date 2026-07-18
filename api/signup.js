function pickFirstDefined(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }

    return undefined;
}

function getLandingToken() {
    return process.env.LANDING_SIGNUP_TOKEN || process.env.X_LANDING_TOKEN;
}

function getSupabaseAuthToken() {
    return (
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        process.env.SUPABASE_EDGE_FUNCTION_JWT ||
        null
    );
}

function getRawPayload(reqBody) {
    const candidate =
        reqBody.paymentRawPayload ||
        reqBody.paymentRaw ||
        reqBody.payment ||
        reqBody.raw ||
        reqBody.paymentData;

    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        return candidate;
    }

    return {};
}

function buildRecurringFields(reqBody) {
    const explicitRawPayload = getRawPayload(reqBody);
    const providerPaymentMethodToken = pickFirstDefined(
        reqBody.providerPaymentMethodToken,
        reqBody.paymentMethodToken,
        reqBody.creditCardToken,
        explicitRawPayload?.creditCardToken
    );
    const remoteIp = pickFirstDefined(
        reqBody.remoteIp,
        explicitRawPayload?.remoteIp,
        explicitRawPayload?.payment?.remoteIp
    );
    const creditCardHolderInfo = pickFirstDefined(
        reqBody.creditCardHolderInfo,
        explicitRawPayload?.creditCardHolderInfo,
        explicitRawPayload?.payment?.creditCardHolderInfo
    );
    const paymentRawPayload = {
        ...explicitRawPayload,
        creditCardToken: pickFirstDefined(
            explicitRawPayload?.creditCardToken,
            providerPaymentMethodToken
        ),
        remoteIp: pickFirstDefined(
            explicitRawPayload?.remoteIp,
            remoteIp
        ),
        creditCardHolderInfo: pickFirstDefined(
            explicitRawPayload?.creditCardHolderInfo,
            creditCardHolderInfo
        )
    };

    return {
        paymentAmount: pickFirstDefined(
            reqBody.paymentAmount,
            explicitRawPayload?.payment?.value
        ),
        paymentCurrency: pickFirstDefined(
            reqBody.paymentCurrency,
            'BRL'
        ),
        providerReference: pickFirstDefined(
            reqBody.providerReference,
            explicitRawPayload?.payment?.invoiceNumber,
            explicitRawPayload?.payment?.externalReference,
            explicitRawPayload?.payment?.id
        ),
        paymentDescription: pickFirstDefined(
            reqBody.paymentDescription,
            explicitRawPayload?.payment?.description
        ),
        providerCustomerId: pickFirstDefined(
            reqBody.providerCustomerId,
            explicitRawPayload?.customer?.id
        ),
        providerCardId: pickFirstDefined(
            reqBody.providerCardId,
            explicitRawPayload?.creditCardToken
        ),
        providerPaymentMethodToken,
        paymentMethodId: pickFirstDefined(
            reqBody.paymentMethodId,
            'credit_card'
        ),
        issuerId: pickFirstDefined(
            reqBody.issuerId,
            reqBody.cardBrand
        ),
        cardBrand: pickFirstDefined(
            reqBody.cardBrand,
            explicitRawPayload?.payment?.creditCard?.creditCardBrand,
            explicitRawPayload?.payment?.creditCardBrand
        ),
        cardLastFour: pickFirstDefined(
            reqBody.cardLastFour
        ),
        firstPaymentProviderPaymentId: pickFirstDefined(
            reqBody.firstPaymentProviderPaymentId,
            explicitRawPayload?.payment?.id
        ),
        remoteIp,
        creditCardHolderInfo,
        providerSubscriptionId: pickFirstDefined(
            reqBody.providerSubscriptionId,
            reqBody.subscriptionId,
            explicitRawPayload?.subscription?.id
        ),
        paymentRawPayload
    };
}

function validateRequiredFields({ finalName, email, password, phone }) {
    const missing = [];

    if (!finalName) missing.push('name');
    if (!email) missing.push('email');
    if (!password) missing.push('password');
    if (!phone) missing.push('phone');

    return missing;
}

function validateRecurringFields(recurringFields) {
    const missing = [];

    if (!recurringFields.providerCustomerId) missing.push('providerCustomerId');
    if (!recurringFields.providerPaymentMethodToken) {
        missing.push('providerPaymentMethodToken');
    }
    if (!recurringFields.remoteIp) missing.push('remoteIp');
    if (!recurringFields.providerSubscriptionId) {
        missing.push('providerSubscriptionId');
    }

    return missing;
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            message: 'Método não permitido'
        });
    }

    try {
        const {
            fullName,
            name,
            phone,
            email,
            password,
            plan,
            billingCycle,
            brandName,
            logoUrl,
            paymentStatus,
            paymentProvider,
            paymentId
        } = req.body || {};

        const finalName = fullName || name;
        const finalPlan = plan || 'free';
        const finalBrandName = brandName || finalName;
        const isPaidPlan = finalPlan !== 'free';

        const missingBaseFields = validateRequiredFields({
            finalName,
            email,
            password,
            phone
        });

        if (missingBaseFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Campos obrigatórios ausentes.',
                missingFields: missingBaseFields
            });
        }

        if (isPaidPlan && !paymentId) {
            return res.status(400).json({
                success: false,
                message: 'PaymentId não chegou na API.',
                recebido: req.body
            });
        }

        if (isPaidPlan && paymentProvider !== 'asaas') {
            return res.status(400).json({
                success: false,
                message: 'PaymentProvider inválido para plano pago.',
                recebido: paymentProvider
            });
        }

        const recurringFields = isPaidPlan
            ? buildRecurringFields(req.body)
            : {};

        if (isPaidPlan) {
            const missingRecurringFields = validateRecurringFields(recurringFields);

            if (missingRecurringFields.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Dados recorrentes incompletos. Conta paga não criada.',
                    missingRecurringFields,
                    recebido: req.body,
                    recurringFields
                });
            }
        }

        const body = {
            name: finalName,
            email,
            password,
            phone,
            brandName: finalBrandName,
            logoUrl: logoUrl || '',
            plan: finalPlan,
            billingCycle: isPaidPlan ? (billingCycle || 'monthly') : undefined,
            paymentStatus: isPaidPlan ? paymentStatus : undefined,
            paymentProvider: isPaidPlan ? paymentProvider : undefined,
            paymentId: isPaidPlan ? paymentId : undefined,
            ...recurringFields
        };

        const landingToken = getLandingToken();
        const supabaseAuthToken = getSupabaseAuthToken();

        if (!landingToken) {
            return res.status(500).json({
                success: false,
                message: 'Configure LANDING_SIGNUP_TOKEN ou X_LANDING_TOKEN.'
            });
        }

        if (!supabaseAuthToken) {
            return res.status(500).json({
                success: false,
                message: 'Configure SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_ANON_KEY.'
            });
        }

        const response = await fetch(
            'https://cdtouwfxwuhnlzqhcagy.supabase.co/functions/v1/create-personal-account',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${supabaseAuthToken}`,
                    'x-landing-token': landingToken
                },
                body: JSON.stringify(body)
            }
        );

        const data = await response.json();

        return res.status(response.status).json({
            success: response.ok,
            message: data.message || data.error || 'Retorno da Supabase',
            recurringReady: data.recurringReady,
            loginUrl: data.loginUrl,
            enviadoParaSupabase: body,
            supabase: data
        });
    } catch (error) {
        console.error('Signup Error:', error);

        return res.status(500).json({
            success: false,
            message: 'Erro interno',
            error: error.message
        });
    }
};
