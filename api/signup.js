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
            paymentStatus,
            paymentProvider,
            paymentId
        } = req.body;

        const finalName = fullName || name;
        const finalPlan = plan || 'free';
        if (finalPlan !== 'free' && !paymentId) {
            return res.status(400).json({
                success: false,
                message: 'PaymentId não chegou na API',
                recebido: req.body
            });
        }
        const body = {
            name: finalName,
            email,
            password,
            phone,
            brandName: finalName,
            logoUrl: "",
            plan: finalPlan,
            paymentStatus,
            paymentProvider,
            paymentId
        };

        console.log("REQ BODY RECEBIDO:", req.body);
        console.log("BODY SUPABASE:", body);

        const response = await fetch(
            'https://cdtouwfxwuhnlzqhcagy.supabase.co/functions/v1/create-personal-account',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-landing-token': 'fb69dfaf8f4d4f52a3c39eacdebb398dfe23d98f6c914acab7bf0ec62bd2075a'
                },
                body: JSON.stringify(body)
            }
        );

        const data = await response.json();

        return res.status(response.status).json({
            success: response.ok,
            message: data.message || data.error || 'Retorno da Supabase',
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