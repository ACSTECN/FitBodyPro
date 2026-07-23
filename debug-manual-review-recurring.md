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
- Correcao minima aplicada em `planos.html` antes do novo reteste:
  - valores dos planos alinhados com o backend (`starter = 5,00`, `premium = 3,00`);
  - remocao do fallback generico `Cliente FitBody` para nome do titular;
  - validacao explicita de nome completo e e-mail antes do envio do pagamento;
  - textos do modal ajustados para refletir fluxo somente com cartao.
- Ajuste adicional aplicado apos novo sintoma em runtime:
  - o `onSubmit` do Card Payment Brick agora recebe tambem `additionalData`;
  - o nome do titular passa a priorizar `additionalData.cardholderName`, que e um campo documentado pelo Mercado Pago para esse callback.
- Evidencia nova trazida pelo reteste do usuario:
  - a resposta do frontend mostrou `status = in_process` e `statusDetail = pending_review_manual`;
  - o `providerCustomerId` veio valido;
  - o `paymentRawPayload.customer` retornado pelo Mercado Pago mostrava historico anterior, incluindo multiplos cartoes salvos, reforcando a hipotese de reaproveitamento de customer antigo por email.
- Resultado da tentativa com `customer` sempre novo:
  - o fluxo passou a falhar antes da cobranca com `400 invalid parameters`;
  - o sintoma e compativel com tentativa de criar `customer` duplicado no Mercado Pago para um email que ja existe.
- Correcao aplicada com base nessa nova evidencia:
  - `ensureCustomer()` voltou a reutilizar o `customer` encontrado por email;
  - antes de salvar o cartao, o backend agora atualiza o `customer` existente com nome e documento mais recentes usando `PUT /v1/customers/{id}`.
- Evidencia complementar trazida pelo usuario:
  - com email ja usado, o fluxo ainda podia cair em erro de parametros;
  - com email novo, a cobranca voltava para `pending_review_manual`.
- Correcao aplicada nesta rodada:
  - `updateCustomer()` deixou de enviar o campo `email` no `PUT`, reduzindo o risco de `invalid parameters` para customers ja existentes;
  - o fluxo pago agora coleta `nome`, `email` e `telefone` antes do Brick e envia esses dados ao backend;
  - o backend passa a enriquecer `customer`, `payer` e `additional_info` do primeiro pagamento com telefone e item da assinatura para aumentar o contexto do antifraude;
  - os dados de contato informados no pagamento ficam reaproveitados na `success.html`.
- Nova correcao aplicada com foco na aprovacao do primeiro charge recorrente:
  - o `v1/payments` volta a enviar `point_of_interaction.type = SUBSCRIPTIONS`;
  - o payload inclui `transaction_data.first_time_use = true`, `subscription_id`, `subscription_sequence.number = 1`, `invoice_period` mensal, `billing_date` e `user_present = true`;
  - adicionado `statement_descriptor` consistente para a cobranca inicial.
- Ajuste adicional aplicado apos nova leitura da documentacao de mensageria do MP:
  - `payer` do primeiro pagamento agora inclui `id = customer.id` e `type = customer`, mantendo tambem `email`;
  - `subscription_sequence.total` passou a ser enviado como `null` para refletir assinatura mensal sem quantidade predefinida.
- Nova frente aplicada com foco em antifraude e autenticacao:
  - `planos.html` passou a carregar `https://www.mercadopago.com/v2/security.js` na tela de checkout;
  - o frontend agora envia `deviceId` (`MP_DEVICE_SESSION_ID`) para `/api/create-payment`;
  - o backend envia `X-meli-session-id` para o Mercado Pago ao criar o pagamento;
  - o primeiro charge passou a usar `three_d_secure_mode = optional` e a resposta agora devolve `threeDSInfo` quando existir.
- Correcao adicional com foco em contexto de risco:
  - o modal de pagamento agora coleta `CEP` e `numero`, buscando o endereco automaticamente via ViaCEP;
  - o frontend envia `zipCode`, `streetName`, `streetNumber`, `neighborhood`, `city` e `state` para `/api/create-payment`;
  - o backend passou a incluir endereco no `customer`, no `payer` e em `additional_info.payer.address`.
- Ajuste corretivo apos retorno `invalid parameters: address.address.street_number is wrong`:
  - o backend passou a normalizar `street_number` como numero antes de enviar ao Mercado Pago, em vez de texto.
- Ajuste corretivo apos retorno `The name of the following parameters is wrong: [additional_info.payer.address.city, additional_info.payer.address.federal_unit, additional_info.payer.address.neighborhood]`:
  - `additional_info.payer.address` voltou a enviar apenas `zip_code`, `street_name` e `street_number`, removendo os campos extras que o Mercado Pago nao reconhece nesse objeto.
- Verificacao local concluida:
  - script inline de `planos.html` valido;
  - `api/create-payment.js` valido;
  - interface local exibe `FitBody Starter = 5,00`, `Fit Body Premium = 3,00` e `priceDisplay = R$ 5,00` no modal do plano Starter.

## Status
- Correcao aplicada e pronta para novo reteste com cobranca real no ambiente com credenciais.
