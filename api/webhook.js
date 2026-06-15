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
        const { type, data } = req.body;
        
        // Only handle payment events
        if (type === 'payment') {
            // Get payment details
            const paymentId = data.id;
            
            const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: {
                    'Authorization': `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN || 'APP_USR-1299466235883241-102116-24fec28f28914fa1efa5da0c7d739d40-231219998'}`
                }
            });

            const paymentData = await paymentResponse.json();

            if (paymentData.status === 'approved') {
                // Get metadata should have our user data from the preference we created
                // For now, just log it
                console.log('Payment approved!', paymentData);
            }
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
}
