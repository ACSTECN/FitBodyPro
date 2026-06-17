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
            name: fullName,
            email,
            password,
            phone,
            brandName: fullName, // default brand name to user's full name
            logoUrl: "",
            plan: plan || 'free'
        }

        if (paymentStatus) {
            body.paymentStatus = paymentStatus
            body.paymentProvider = paymentProvider
            body.paymentId = paymentId
        }

        const response = await fetch('https://cdtouwfxwuhnlzqhcagy.supabase.co/functions/v1/create-personal-account', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-landing-token': 'fb69dfaf8f4d4f52a3c39eacdebb398dfe23d98f6c914acab7bf0ec62bd2075a'
            },
            body: JSON.stringify(body)
        })

        const data = await response.json()

        if (response.ok) {
            return res.status(200).json({
                success: true,
                message: 'Conta criada com sucesso!',
                loginUrl: 'https://gerenciaralunos.vercel.app/login',
                ...data
            })
        } else {
            return res.status(response.status).json(data)
        }
    } catch (error) {
        console.error(error)
        return res.status(500).json({ message: 'Erro interno do servidor' })
    }
}
