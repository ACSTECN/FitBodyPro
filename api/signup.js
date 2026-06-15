export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método não permitido' })
  }

  try {
    const { fullName, phone, email, password } = req.body

    if (!fullName || !phone || !email || !password) {
      return res.status(400).json({ message: 'Preencha todos os campos' })
    }

    const response = await fetch('https://cdtouwfxwuhnlzqhcagy.supabase.co/functions/v1/create-personal-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'sb_publishable_lq2T16dGip4Fvacb3uVFXQ_D6C-sJBa',
        'Authorization': `Bearer ${process.env.LANDING_SIGNUP_TOKEN}`
      },
      body: JSON.stringify({
        fullName,
        phone,
        email,
        password,
        source: 'landing'
      })
    })

    const data = await response.json()

    if (response.ok) {
      return res.status(200).json(data)
    } else {
      return res.status(response.status).json(data)
    }
  } catch (error) {
    return res.status(500).json({ message: 'Erro interno do servidor' })
  }
}