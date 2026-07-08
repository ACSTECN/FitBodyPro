function pickFirstDefined(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }
    return undefined;
}

async function fetchMercadoPagoPayment(paymentId) {
    const MP_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;

    if (!MP_ACCESS_TOKEN) {
        throw new Error('MERCADO_PAGO_ACCESS_TOKEN não configurado.');
    }

    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
            Authorization: `Bearer ${MP_ACCESS_TOKEN}`
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || 'Não foi possível consultar o pagamento no Mercado Pago');
    }

    return data;
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

function buildRecurringFields(reqBody, mpPaymentData) {
    const explicitRawPayload = reqBody.paymentRawPayload || {};

    return {
        paymentAmount: pickFirstDefined(
            reqBody.paymentAmount,
            explicitRawPayload?.payment?.transaction_amount,
            mpPaymentData?.transaction_amount
        ),
        paymentCurrency: pickFirstDefined(
            reqBody.paymentCurrency,
            explicitRawPayload?.payment?.currency_id,
            mpPaymentData?.currency_id
        ),
        providerReference: pickFirstDefined(
            reqBody.providerReference,
            explicitRawPayload?.payment?.order?.id,
            explicitRawPayload?.payment?.external_reference,
            mpPaymentData?.order?.id,
            mpPaymentData?.external_reference,
            mpPaymentData?.id
        ),
        paymentDescription: pickFirstDefined(
            reqBody.paymentDescription,
            explicitRawPayload?.payment?.description,
            mpPaymentData?.description
        ),
        providerCustomerId: pickFirstDefined(
            reqBody.providerCustomerId,
            explicitRawPayload?.customer?.id,
            explicitRawPayload?.savedCard?.customer_id,
            mpPaymentData?.customer?.id
        ),
        providerCardId: pickFirstDefined(
            reqBody.providerCardId,
            explicitRawPayload?.savedCard?.id,
            mpPaymentData?.card?.id
        ),
        paymentMethodId: pickFirstDefined(
            reqBody.paymentMethodId,
            explicitRawPayload?.savedCard?.payment_method?.id,
            explicitRawPayload?.payment?.payment_method_id,
            mpPaymentData?.payment_method_id
        ),
        issuerId: pickFirstDefined(
            reqBody.issuerId,
            explicitRawPayload?.savedCard?.issuer?.id,
            explicitRawPayload?.payment?.issuer_id,
            mpPaymentData?.issuer_id,
            mpPaymentData?.issuer?.id
        ),
        cardBrand: pickFirstDefined(
            reqBody.cardBrand,
            explicitRawPayload?.savedCard?.payment_method?.id,
            mpPaymentData?.payment_method?.id,
            mpPaymentData?.card?.brand
        ),
        cardLastFour: pickFirstDefined(
            reqBody.cardLastFour,
            explicitRawPayload?.savedCard?.last_four_digits,
            mpPaymentData?.card?.last_four_digits
        ),
        firstPaymentProviderPaymentId: pickFirstDefined(
            reqBody.firstPaymentProviderPaymentId,
            explicitRawPayload?.payment?.id,
            mpPaymentData?.id
        ),
        providerSubscriptionId: pickFirstDefined(
            reqBody.providerSubscriptionId,
            explicitRawPayload?.payment?.metadata?.providerSubscriptionId,
            mpPaymentData?.subscription_id,
            mpPaymentData?.recurring_id,
            mpPaymentData?.metadata?.providerSubscriptionId
        ),
        paymentRawPayload: pickFirstDefined(
            reqBody.paymentRawPayload,
            mpPaymentData
        )
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
    if (!recurringFields.providerCardId) missing.push('providerCardId');
    if (!recurringFields.paymentMethodId) missing.push('paymentMethodId');
    if (!recurringFields.cardBrand) missing.push('cardBrand');
    if (!recurringFields.cardLastFour) missing.push('cardLastFour');
    if (!recurringFields.firstPaymentProviderPaymentId) {
        missing.push('firstPaymentProviderPaymentId');
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
                message: 'PaymentId não chegou na API',
                recebido: req.body
            });
        }

        if (isPaidPlan && paymentProvider !== 'mercadopago') {
            return res.status(400).json({
                success: false,
                message: 'PaymentProvider inválido para plano pago.',
                recebido: paymentProvider
            });
        }

        let mercadoPagoPayment = null;

        if (isPaidPlan && paymentId) {
            try {
                mercadoPagoPayment = await fetchMercadoPagoPayment(paymentId);
            } catch (mpError) {
                console.error('Erro ao enriquecer pagamento do Mercado Pago:', mpError.message);
            }
        }

        const recurringFields = isPaidPlan
            ? buildRecurringFields(req.body, mercadoPagoPayment)
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

        console.log('REQ BODY RECEBIDO:', req.body);
        console.log('BODY SUPABASE:', body);

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