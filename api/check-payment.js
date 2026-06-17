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
        const { paymentId } = req.body;

        if (!paymentId) {
            return res.status(400).json({ message: 'ID do pagamento obrigatório' });
        }

        const MP_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN || 'APP_USR-1299466235883241-102116-24fec28f28914fa1efa5da0c7d739d40-231219998';

        const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
        });

        const paymentData = await response.json();
        console.log('Payment check response:', paymentData);

        const isApproved = paymentData.status === 'approved';
        return res.status(200).json({ approved: isApproved, status: paymentData.status, data: paymentData });
    } catch (error) {
        console.error('Check Payment Error:', error);
        return res.status(500).json({ message: 'Erro interno do servidor', error: error.message });
    }
};
