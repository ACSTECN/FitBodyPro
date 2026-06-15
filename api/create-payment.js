module.exports = async function handler(req, res) {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    )

    if (req.method === 'OPTIONS') {
        return res.status(200).end()
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Método não permitido' })
    }

    try {
        const { plan, method } = req.body

        if (!plan) {
            return res.status(400).json({ message: 'Plano obrigatório' })
        }

        const planDetails = {
            starter: {
                title: 'Fitbory Starter',
                price: 1.00,
                description: 'Todos os acessos até 10 alunos'
            },
            premium: {
                title: 'Fit Bory Premium',
                price: 1.20,
                description: 'Tudo ilimitado'
            }
        }

        const selectedPlan = planDetails[plan]
        if (!selectedPlan) {
            return res.status(400).json({ message: 'Plano inválido' })
        }

        const MP_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN || 'APP_USR-1299466235883241-102116-24fec28f28914fa1efa5da0c7d739d40-231219998'

        // Create payment with Mercado Pago
        const paymentBody = {
            transaction_amount: selectedPlan.price,
            description: selectedPlan.description,
            payment_method_id: method === 'pix' ? 'pix' : 'mastercard', // Default to pix
            payer: {
                email: 'test@test.com' // Placeholder, we'll get real email later
            },
            metadata: { plan }
        }

        const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
            },
            body: JSON.stringify(paymentBody)
        })

        const paymentData = await mpResponse.json()

        if (mpResponse.ok) {
            const responseData = {
                success: true,
                paymentId: paymentData.id
            }

            if (method === 'pix' && paymentData.point_of_interaction && paymentData.point_of_interaction.transaction_data) {
                responseData.pixCode = paymentData.point_of_interaction.transaction_data.qr_code
                responseData.qrCode = paymentData.point_of_interaction.transaction_data.qr_code_base64
            } else {
                // Create preference for redirect flow
                const prefResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
                    },
                    body: JSON.stringify({
                        items: [{
                            title: selectedPlan.title,
                            description: selectedPlan.description,
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
                })

                const prefData = await prefResponse.json()
                responseData.init_point = prefData.init_point
                responseData.sandbox_init_point = prefData.sandbox_init_point
            }

            return res.status(200).json(responseData)
        } else {
            return res.status(mpResponse.status).json(paymentData)
        }
    } catch (error) {
        console.error(error)
        return res.status(500).json({ message: 'Erro interno do servidor' })
    }
}
