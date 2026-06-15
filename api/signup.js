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
        const { fullName, phone, email, password, plan, paymentStatus, paymentProvider, paymentId } = req.body

        if (!fullName || !phone || !email || !password) {
            return res.status(400).json({ message: 'Preencha todos os campos' })
        }

        const body = {
            fullName,
            phone,
            email,
            password,
            source: 'landing',
            plan: plan || 'free'
        }

        if (paymentStatus) body.paymentStatus = paymentStatus
        if (paymentProvider) body.paymentProvider = paymentProvider
        if (paymentId) body.paymentId = paymentId

        const response = await fetch('https://cdtouwfxwuhnlzqhcagy.supabase.co/functions/v1/create-personal-account', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': 'sb_publishable_lq2T16dGip4Fvacb3uVFXQ_D6C-sJBa',
                'Authorization': 'Bearer 028f76b096714e85a6ca43ca7fded6a0062b7df6d1c146ccb4cf289d66eb6d53'
            },
            body: JSON.stringify(body)
        })

        const data = await response.json()

        if (response.ok) {
            return res.status(200).json(data)
        } else {
            return res.status(response.status).json(data)
        }
    } catch (error) {
        console.error(error)
        return res.status(500).json({ message: 'Erro interno do servidor' })
    }
}