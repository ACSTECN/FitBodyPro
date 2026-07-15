const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || null;
const ASAAS_API_BASE_URL =
    process.env.ASAAS_API_BASE_URL ||
    (String(process.env.ASAAS_ENV || '').toLowerCase() === 'sandbox'
        ? 'https://api-sandbox.asaas.com/v3'
        : 'https://api.asaas.com/v3');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, asaas-access-token'
    );

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Método não permitido' });
    }

    try {
        if (ASAAS_WEBHOOK_TOKEN) {
            const receivedToken = req.headers['asaas-access-token'];

            if (receivedToken !== ASAAS_WEBHOOK_TOKEN) {
                return res.status(401).json({ message: 'Token do webhook inválido.' });
            }
        }

        const { event, payment } = req.body || {};
        const paymentId = payment?.id || null;

        if (!event) {
            return res.status(400).json({ message: 'Evento do webhook não informado.' });
        }

        if (!paymentId || !ASAAS_API_KEY) {
            return res.status(200).json({ success: true, ignored: true });
        }

        const paymentResponse = await fetch(`${ASAAS_API_BASE_URL}/payments/${paymentId}`, {
            headers: {
                accept: 'application/json',
                'User-Agent': 'FitboryPro/1.0.0',
                access_token: ASAAS_API_KEY
            }
        });

        const paymentData = await paymentResponse.json();

        console.log('Asaas webhook event:', {
            event,
            paymentId,
            status: paymentData?.status || payment?.status || null
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook Error:', error);
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};
