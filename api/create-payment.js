module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Método não permitido' });
    }

    try {
        const { plan, method, email } = req.body;

        if (!plan) {
            return res.status(400).json({ message: 'Plano obrigatório' });
        }

        const planDetails = {
            starter: { title: 'Fitbory Starter', price: 14.90 },
            premium: { title: 'Fit Bory Premium', price: 0.01 }
        };
        const selectedPlan = planDetails[plan];
        if (!selectedPlan) {
            return res.status(400).json({ message: 'Plano inválido' });
        }

        const MP_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN || 'APP_USR-1299466235883241-102116-24fec28f28914fa1efa5da0c7d739d40-231219998';
        const responseData = { success: true };

        if (method === 'checkout-pro') {
            const prefResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
                body: JSON.stringify({
                    items: [{
                        title: selectedPlan.title,
                        description: selectedPlan.title,
                        quantity: 1,
                        currency_id: 'BRL',
                        unit_price: selectedPlan.price
                    }],
                    back_urls: {
                        success: `https://fit-body-pro-one.vercel.app/success.html?plan=${plan}`,
                        failure: 'https://fit-body-pro-one.vercel.app/planos.html',
                        pending: 'https://fit-body-pro-one.vercel.app/planos.html'
                    },
                    auto_return: 'approved',
                    metadata: { plan }
                })
            });
            const prefData = await prefResponse.json();
            if (prefResponse.ok) {
                responseData.init_point = prefData.init_point;
                responseData.sandbox_init_point = prefData.sandbox_init_point;
            } else {
                console.error('Checkout Pro Error:', prefData);
                return res.status(prefResponse.status).json(prefData);
            }
        } else {
            const paymentBody = {
                transaction_amount: selectedPlan.price,
                description: selectedPlan.title,
                payment_method_id: 'pix',
                payer: { 
                    email: email || 'test@test.com', 
                    first_name: 'Cliente',
                    last_name: 'Fitbory'
                },
                metadata: { plan },
                notification_url: 'https://fit-body-pro-one.vercel.app/api/webhook'
            };

            const idempotencyKey = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

            const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json', 
                    'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
                    'X-Idempotency-Key': idempotencyKey
                },
                body: JSON.stringify(paymentBody)
            });

            const paymentData = await mpResponse.json();
            console.log('MP Pix payment response:', paymentData);

            if (mpResponse.ok) {
                responseData.paymentId = paymentData.id;
                if (paymentData.point_of_interaction?.transaction_data) {
                    responseData.pixCode = paymentData.point_of_interaction.transaction_data.qr_code;
                    responseData.qrCode = paymentData.point_of_interaction.transaction_data.qr_code_base64;
                    responseData.ticketUrl = paymentData.point_of_interaction.transaction_data.ticket_url;
                }
            } else {
                console.error('MP Pix Error:', paymentData);
                return res.status(mpResponse.status).json(paymentData);
            }
        }

        return res.status(200).json(responseData);
    } catch (error) {
        console.error('Payment Error:', error);
        return res.status(500).json({ message: 'Erro interno do servidor', error: error.message });
    }
};
