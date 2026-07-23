const { decodeRecoveryToken } = require('./recovery-token');

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

function getRecoveryContext(reqBody) {
    const recoveryToken = reqBody.recoveryToken || reqBody.signupRecoveryToken || null;

    if (!recoveryToken) {
        return null;
    }

    try {
        return decodeRecoveryToken(recoveryToken);
    } catch (error) {
        return null;
    }
}

function buildRecurringFields(reqBody, recoveryContext) {
    const recoveredRecurringData = recoveryContext?.recurringData || {};
    const explicitRawPayload = getRawPayload(reqBody);
    const recoveryRawPayload =
        recoveredRecurringData.paymentRawPayload &&
        typeof recoveredRecurringData.paymentRawPayload === 'object'
            ? recoveredRecurringData.paymentRawPayload
            : {};
    const providerPaymentMethodToken = pickFirstDefined(
        recoveredRecurringData.providerPaymentMethodToken,
        reqBody.providerPaymentMethodToken,
        reqBody.paymentMethodToken,
        reqBody.creditCardToken,
        explicitRawPayload?.creditCardToken,
        recoveryRawPayload?.creditCardToken
    );
    const remoteIp = pickFirstDefined(
        recoveredRecurringData.remoteIp,
        reqBody.remoteIp,
        explicitRawPayload?.remoteIp,
        explicitRawPayload?.payment?.remoteIp,
        recoveryRawPayload?.remoteIp,
        recoveryRawPayload?.payment?.remoteIp
    );
    const creditCardHolderInfo = pickFirstDefined(
        recoveredRecurringData.creditCardHolderInfo,
        reqBody.creditCardHolderInfo,
        explicitRawPayload?.creditCardHolderInfo,
        explicitRawPayload?.payment?.creditCardHolderInfo,
        recoveryRawPayload?.creditCardHolderInfo,
        recoveryRawPayload?.payment?.creditCardHolderInfo
    );
    const paymentRawPayload = {
        ...recoveryRawPayload,
        ...explicitRawPayload,
        creditCardToken: pickFirstDefined(
            explicitRawPayload?.creditCardToken,
            recoveryRawPayload?.creditCardToken,
            providerPaymentMethodToken
        ),
        remoteIp: pickFirstDefined(
            explicitRawPayload?.remoteIp,
            recoveryRawPayload?.remoteIp,
            remoteIp
        ),
        creditCardHolderInfo: pickFirstDefined(
            explicitRawPayload?.creditCardHolderInfo,
            recoveryRawPayload?.creditCardHolderInfo,
            creditCardHolderInfo
        )
    };

    return {
        paymentAmount: pickFirstDefined(
            recoveredRecurringData.paymentAmount,
            reqBody.paymentAmount,
            explicitRawPayload?.payment?.value,
            recoveryRawPayload?.payment?.value
        ),
        paymentCurrency: pickFirstDefined(
            recoveredRecurringData.paymentCurrency,
            reqBody.paymentCurrency,
            'BRL'
        ),
        providerReference: pickFirstDefined(
            recoveredRecurringData.providerReference,
            reqBody.providerReference,
            explicitRawPayload?.payment?.invoiceNumber,
            explicitRawPayload?.payment?.externalReference,
            explicitRawPayload?.payment?.id,
            recoveryRawPayload?.payment?.externalReference,
            recoveryRawPayload?.payment?.id
        ),
        paymentDescription: pickFirstDefined(
            recoveredRecurringData.paymentDescription,
            reqBody.paymentDescription,
            explicitRawPayload?.payment?.description,
            recoveryRawPayload?.payment?.description
        ),
        providerCustomerId: pickFirstDefined(
            recoveredRecurringData.providerCustomerId,
            reqBody.providerCustomerId,
            explicitRawPayload?.customer?.id,
            recoveryRawPayload?.customer?.id
        ),
        providerCardId: pickFirstDefined(
            recoveredRecurringData.providerCardId,
            reqBody.providerCardId,
            explicitRawPayload?.creditCardToken,
            recoveryRawPayload?.creditCardToken
        ),
        providerPaymentMethodToken,
        paymentMethodId: pickFirstDefined(
            recoveredRecurringData.paymentMethodId,
            reqBody.paymentMethodId,
            'credit_card'
        ),
        issuerId: pickFirstDefined(
            recoveredRecurringData.issuerId,
            reqBody.issuerId,
            reqBody.cardBrand,
            recoveredRecurringData.cardBrand
        ),
        cardBrand: pickFirstDefined(
            recoveredRecurringData.cardBrand,
            reqBody.cardBrand,
            explicitRawPayload?.payment?.creditCard?.creditCardBrand,
            explicitRawPayload?.payment?.creditCardBrand,
            recoveryRawPayload?.payment?.creditCard?.creditCardBrand,
            recoveryRawPayload?.payment?.creditCardBrand
        ),
        cardLastFour: pickFirstDefined(
            recoveredRecurringData.cardLastFour,
            reqBody.cardLastFour
        ),
        firstPaymentProviderPaymentId: pickFirstDefined(
            recoveredRecurringData.firstPaymentProviderPaymentId,
            reqBody.firstPaymentProviderPaymentId,
            explicitRawPayload?.payment?.id,
            recoveryRawPayload?.payment?.id
        ),
        remoteIp,
        creditCardHolderInfo,
        providerSubscriptionId: pickFirstDefined(
            recoveredRecurringData.providerSubscriptionId,
            reqBody.providerSubscriptionId,
            reqBody.subscriptionId,
            explicitRawPayload?.subscription?.id,
            recoveryRawPayload?.subscription?.id
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
        const recoveryContext = getRecoveryContext(req.body || {});

        const finalName = fullName || name;
        const finalPlan = plan || recoveryContext?.plan || 'free';
        const finalBrandName = brandName || finalName;
        const isPaidPlan = finalPlan !== 'free';
        const finalPaymentId = pickFirstDefined(paymentId, recoveryContext?.paymentId);
        const finalPaymentProvider = isPaidPlan ? 'asaas' : paymentProvider;
        const finalPaymentStatus = isPaidPlan
            ? pickFirstDefined(paymentStatus, recoveryContext?.recurringData?.paymentStatus, 'RECEIVED')
            : paymentStatus;

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

        if (isPaidPlan && !finalPaymentId) {
            return res.status(400).json({
                success: false,
                message: 'PaymentId não chegou na API.',
                recebido: req.body
            });
        }

        if (isPaidPlan && finalPaymentProvider !== 'asaas') {
            return res.status(400).json({
                success: false,
                message: 'PaymentProvider inválido para plano pago.',
                recebido: finalPaymentProvider
            });
        }

        const recurringFields = isPaidPlan
            ? buildRecurringFields(req.body, recoveryContext)
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
            paymentStatus: isPaidPlan ? finalPaymentStatus : undefined,
            paymentProvider: isPaidPlan ? finalPaymentProvider : undefined,
            paymentId: isPaidPlan ? finalPaymentId : undefined,
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
