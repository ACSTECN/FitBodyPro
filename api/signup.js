function pickFirstDefined(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }
    return undefined;
}

async function fetchMercadoPagoPayment(paymentId) {
    const MP_ACCESS_TOKEN =
        process.env.MERCADO_PAGO_ACCESS_TOKEN ||
        'APP_USR-1299466235883241-102116-24fec28f28914fa1efa5da0c7d739d40-231219998';

    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
            'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || 'Nao foi possivel consultar o pagamento no Mercado Pago');
    }

    return data;
}

function getLandingToken() {
    return (
        process.env.LANDING_SIGNUP_TOKEN ||
        process.env.X_LANDING_TOKEN ||
        'fb69dfaf8f4d4f52a3c39eacdebb398dfe23d98f6c914acab7bf0ec62bd2075a'
    );
}

function buildRecurringFields(reqBody, mpPaymentData) {
    return {
        paymentAmount: pickFirstDefined(
            reqBody.paymentAmount,
            mpPaymentData?.transaction_amount
        ),
        paymentCurrency: pickFirstDefined(
            reqBody.paymentCurrency,
            mpPaymentData?.currency_id
        ),
        providerReference: pickFirstDefined(
            reqBody.providerReference,
            mpPaymentData?.order?.id,
            mpPaymentData?.external_reference,
            mpPaymentData?.id
        ),
        paymentDescription: pickFirstDefined(
            reqBody.paymentDescription,
            mpPaymentData?.description
        ),
        providerCustomerId: pickFirstDefined(
            reqBody.providerCustomerId,
            mpPaymentData?.payer?.id,
            mpPaymentData?.customer?.id
        ),
        providerCardId: pickFirstDefined(
            reqBody.providerCardId,
            mpPaymentData?.card?.id
        ),
        paymentMethodId: pickFirstDefined(
            reqBody.paymentMethodId,
            mpPaymentData?.payment_method_id
        ),
        issuerId: pickFirstDefined(
            reqBody.issuerId,
            mpPaymentData?.issuer_id,
            mpPaymentData?.issuer?.id
        ),
        cardBrand: pickFirstDefined(
            reqBody.cardBrand,
            mpPaymentData?.payment_method?.id,
            mpPaymentData?.card?.brand
        ),
        cardLastFour: pickFirstDefined(
            reqBody.cardLastFour,
            mpPaymentData?.card?.last_four_digits
        ),
        firstPaymentProviderPaymentId: pickFirstDefined(
            reqBody.firstPaymentProviderPaymentId,
            mpPaymentData?.id
        ),
        providerSubscriptionId: pickFirstDefined(
            reqBody.providerSubscriptionId,
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

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Método não permitido' });
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
        } = req.body;

        const finalName = fullName || name;
        const finalPlan = plan || 'free';
        const finalBrandName = brandName || finalName;
        const isPaidPlan = finalPlan !== 'free';

        if (finalPlan !== 'free' && !paymentId) {
            return res.status(400).json({
                success: false,
                message: 'PaymentId não chegou na API',
                recebido: req.body
            });
        }

        let mercadoPagoPayment = null;

        if (isPaidPlan && paymentProvider === 'mercadopago' && paymentId) {
            try {
                mercadoPagoPayment = await fetchMercadoPagoPayment(paymentId);
            } catch (mpError) {
                console.error('Erro ao enriquecer pagamento do Mercado Pago:', mpError.message);
            }
        }

        const recurringFields = isPaidPlan
            ? buildRecurringFields(req.body, mercadoPagoPayment)
            : {};

        const body = {
            name: finalName,
            email,
            password,
            phone,
            brandName: finalBrandName,
            logoUrl: logoUrl || "",
            plan: finalPlan,
            billingCycle: isPaidPlan ? (billingCycle || 'monthly') : undefined,
            paymentStatus,
            paymentProvider,
            paymentId,
            ...recurringFields
        };

        console.log("REQ BODY RECEBIDO:", req.body);
        console.log("BODY SUPABASE:", body);

        const landingToken = getLandingToken();

        const response = await fetch(
            'https://cdtouwfxwuhnlzqhcagy.supabase.co/functions/v1/create-personal-account',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${landingToken}`,
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
        return res.status(500).json({
            message: 'Erro interno',
            error: error.message
        });
    }
};
