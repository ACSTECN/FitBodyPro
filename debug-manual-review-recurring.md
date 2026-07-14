# Debug Session: manual-review-recurring [OPEN]

## Sintoma
- Pagamentos com cartao entram em `in_process` com `pending_review_manual`, inclusive com cartao novo.
- O problema passou a aparecer depois das mudancas para salvar os dados de recorrencia do Mercado Pago.

## Escopo
- Backend: `api/create-payment.js`
- Frontend: `planos.html`
- Provedor: Mercado Pago

## Hipoteses
1. O Mercado Pago esta marcando a primeira cobranca em revisao por causa da combinacao `customer + card-on-file + metadata` usada no fluxo novo.
2. O `customer` reutilizado por e-mail esta carregando historico de risco e fazendo ate cartao novo cair em revisao manual.
3. O `savedCard` esta sendo criado corretamente, mas a cobranca inicial esta indo com poucos dados ou dados inconsistentes no `payer`, aumentando o score de risco.
4. O backend esta recebendo um `status_detail` e outros campos relevantes do Mercado Pago que ainda nao estamos capturando em detalhe suficiente para isolar a causa.
5. O comportamento difere entre `savedCard` criado novo e `savedCard` reaproveitado, e precisamos ver isso por tentativa.

## Plano
- Instrumentar `api/create-payment.js` nos pontos: busca/criacao de customer, save de cartao, envio do primeiro payment e resposta do Mercado Pago.
- Reproduzir uma nova tentativa com cartao.
- Ler os logs para confirmar qual hipotese fecha com a resposta real do provedor.
- Aplicar a menor correcao possivel com base na evidencia.

## Evidencias
- Instrumentacao adicionada em `api/create-payment.js` nos pontos:
  - entrada do handler;
  - busca/criacao de `customer`;
  - salvamento do cartao em `/v1/customers/{customerId}/cards`;
  - payload resumido da primeira cobranca;
  - resposta resumida de `/v1/payments`;
  - falhas de backend com `status`, `message` e `cause` do Mercado Pago quando houver.
- Debug Server ativo com sessao `manual-review-recurring` e arquivo `.dbg/manual-review-recurring.env`.

## Status
- Instrumentacao concluida; aguardando reproducao com novo teste para leitura dos logs.
