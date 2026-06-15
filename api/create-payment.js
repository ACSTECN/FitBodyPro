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
        const { plan } = req.body

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

        // Create Mercado Pago preference
        const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN || 'APP_USR-1299466235883241-102116-24fec28f28914fa1efa5da0c7d739d40-231219998'}`
            },
            body: JSON.stringify({
                items: [
                    {
                        title: selectedPlan.title,
                        description: selectedPlan.description,
                        quantity: 1,
                        currency_id: 'BRL',
                        unit_price: selectedPlan.price
                    }
                ],
                back_urls: {
                    success: `https://fit-body-pro-one.vercel.app/success.html?plan=${plan}`,
                    failure: 'https://fit-body-pro-one.vercel.app/planos.html',
                    pending: 'https://fit-body-pro-one.vercel.app/planos.html'
                },
                auto_return: 'approved',
                metadata: { plan }
            })
        })

        const mpData = await mpResponse.json()

        if (mpResponse.ok) {
            return res.status(200).json({ 
                success: true, 
                init_point: mpData.init_point,
                sandbox_init_point: mpData.sandbox_init_point
            })
        } else {
            return res.status(mpResponse.status).json(mpData)
        }
    } catch (error) {
        console.error(error)
        return res.status(500).json({ message: 'Erro interno do servidor' })
    }
}
