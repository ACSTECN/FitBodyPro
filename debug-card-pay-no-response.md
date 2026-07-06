# Debug Session: card-pay-no-response [OPEN]

## Sintoma
- Ao clicar em `Pagar` no fluxo de cartao, nao ha reacao visivel.

## Escopo
- Pagina afetada: `planos.html`
- Fluxo afetado: Brick de cartao do Mercado Pago dentro do modal de pagamento

## Hipoteses
1. O clique fica preso dentro do Brick do Mercado Pago e o callback `onSubmit` nao dispara.
2. O callback `onSubmit` dispara, mas o `formData` chega em formato diferente do esperado e o frontend falha antes do `fetch`.
3. O `fetch('/api/create-payment')` dispara, mas a resposta retorna erro silencioso e a UI nao mostra feedback suficiente.
4. O Brick esta renderizando, mas alguma extensao/erro do navegador interrompe a promessa do submit antes do backend ser chamado.
5. O backend `/api/create-payment` recebe a requisicao, mas rejeita o payload atual do Brick e o frontend nao destaca esse erro corretamente.

## Plano
- Instrumentar `planos.html` com pontos de debug no ciclo: abrir modal -> renderizar Brick -> submit -> chamada API -> resposta/erro.
- Reproduzir o clique em `Pagar`.
- Analisar logs para confirmar ou rejeitar as hipoteses.
- Aplicar a menor correcao necessaria depois da evidencia.

## Evidencias
- O print do usuario mostra apenas a mensagem `Brick do Mercado Pago pronto.` no console; nao ha sinais de `onSubmit`, chamada a `/api/create-payment` ou retorno de backend.
- O topo do Brick aparece cortado no modal: o campo de numero do cartao e o cabecalho do formulario nao estavam visiveis, enquanto campos inferiores apareciam primeiro.
- Isso sugere que o modal estava abrindo com o conteudo do Brick parcialmente oculto por conta do cabecalho sticky e da posicao de scroll.
- Os logs coletados em `.dbg/trae-debug-log-card-pay-no-response.ndjson` mostram multiplos eventos `onSubmit do Brick disparou`, mas sempre com `hasFormData: false` e `keys: []`.
- Nao ha nenhum evento `submitCardPayment:start`, o que prova que o fluxo quebrava antes da entrada efetiva em `submitCardPayment`.

## Analise
- Hipotese 1: rejeitada. O `onSubmit` disparou varias vezes conforme os logs.
- Hipotese 2: confirmada. O callback estava lendo o argumento no formato errado (`({ formData })`), mas o Brick entrega o `formData` diretamente. Isso fazia `submitCardPayment(undefined)` e quebrava antes do `try/catch`.
- Hipotese 3: rejeitada por enquanto; nao ha evidencia de requisicao ao backend porque a quebra acontecia antes do `fetch`.
- Hipotese 4: secundaria. O erro de extensao no console segue sendo ruido, mas nao explica o topo cortado do Brick.
- Hipotese 5: rejeitada por enquanto; sem entrada no backend.

## Correcao aplicada
- Ajustado o layout do modal para nao encobrir o topo do Brick.
- O cabecalho sticky foi reposicionado para `top: 0` com espaco proprio, em vez de sobrepor o conteudo do formulario.
- O modal e resetado para o topo ao abrir o fluxo de cartao e quando o Brick fica pronto.
- O frontend agora mostra `Processando pagamento...` assim que `submitCardPayment` realmente iniciar, facilitando diferenciar entre clique ignorado e requisicao em andamento.
- Corrigido o callback `onSubmit` para receber `formData` diretamente.
- Adicionada validacao explicita para mostrar erro visivel quando o Mercado Pago nao retornar um objeto de formulario valido.

## Status
- Correcao aplicada com causa raiz identificada por evidencia; aguardando reteste do usuario.
