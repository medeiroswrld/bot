# Conselho — Custo e preço justo (2026-10-07)

## Pergunta original

> outra coisa, duvida sobre o valor e meu custo, vcs consegue analisar isso tambem? analisem os preços que são justo para eu cobrar dos clientes tambem

## Pergunta enquadrada

PERGUNTA: "Tenho dúvida sobre o valor e o meu custo. Analisem quais preços são justos para eu cobrar dos clientes."

QUEM: João, fundador solo da Amply (Brasil), constrói o produto sozinho; também é agência de anúncios Meta.

PRODUTO: CRM + bot de IA para lojas de veículos (estoque, leads, lista de espera, contrato, FIPE/placa, feed de estoque, financeiro; bot no WhatsApp oficial e Instagram que consulta estoque ao vivo, manda fotos, agenda visita, entende áudio; disparos; atribuição de anúncio Meta).

TABELA ATUAL (nunca vendida pela tabela): CRM sem bot R$800 · Essencial R$1.497 (100 conversas) · Crescimento R$1.997 (250) · Performance R$2.497 (500). Limite avisa e nunca corta.

CUSTOS CONHECIDOS:
- Variável: ~US$0,23 ≈ R$1,24 por conversa (DSC: 218 conversas em 30 dias = US$50,12; essencialmente IA; conversa iniciada pelo cliente não paga Meta; templates/disparos a Meta cobra no cartão da loja).
- Fixos compartilhados: Supabase Pro US$25 (~R$135); Placa Fipe (era R$15/mês para 20/dia, subiu para 50/dia — preço novo não registrado); Resend, Vercel, domínio. Estimativa: algumas centenas/mês.
- Taxa de cartão do Asaas: alguns % (não verificado).
- Imposto: regime desconhecido (Simples para software ~6–15%, aproximado).
- Maior custo, não medido: horas do João (onboarding manual do WhatsApp oficial, suporte, incidentes).

RECEITA: 2 clientes da agência. DSC ~R$2.000 com bot (218 conversas → ~R$270 de IA). Leandrinho só CRM, "isento".

MERCADO (aprox.): sistemas de revenda custam centenas de reais; vendedor ~R$2.500 + comissão; venda de seminovo deixa alguns milhares de margem.

CONSELHO ANTERIOR: "caro" = falta de prova + oferta mal apresentada; hipótese sem conta: CRM R$397, Bot Entrada R$697 (100), Crescimento R$1.497 (300), Performance R$1.997, implantação R$497.

---

## Respostas dos conselheiros

### O Contrarian

**A falha fatal: vocês estão precificando a coisa errada.** A IA custa R$1,24 por conversa e é irrelevante. O custo que manda é a hora do João, e nenhuma das duas tabelas cobra por ela.

**A conta do plano Bot Entrada a R$697, que o conselho anterior sugeriu:**
- IA: R$124 (100 conversas a R$1,24)
- Imposto (~10%): R$70
- Cartão (~3%): R$21
- Rateio dos custos fixos: ~R$30
- Sobram cerca de R$450 por mês para pagar suporte, incidentes e o "bot calado sem erro".

Três horas de dor de cabeça por mês já comem isso. Um fundador sozinho aguenta uns 12 a 15 clientes com bot antes de virar suporte em tempo integral. Quinze clientes a R$697 dão cerca de R$10 mil brutos: um salário, sem nenhuma reserva para quando o banco travar. Quinze clientes a R$1.497–R$2.497 dão R$25–35 mil. **O teto de clientes é físico. Então o preço por cliente tem que ser alto, não baixo.**

**Implantação a R$497 é suicídio.** O onboarding da API oficial leva de horas a dias, com WABA, token, coexistência e templates. São no mínimo 8 a 15 horas. Cobre de R$1.500 a R$2.500, ou dilua isso numa fidelidade de 12 meses.

**"Avisa e nunca corta" é um cheque em branco.** Uma loja que faz 2.000 conversas no plano Essencial custa R$2.480 só de IA e paga R$1.497. Precisa de cobrança por excedente: R$3 por conversa acima da franquia.

**CRM a R$397 é armadilha.** O cliente sem bot liga igual, pede ajuda igual e paga um quarto. Ou o CRM fica em R$800, ou nem se vende separado.

**O dado que ninguém quer encarar:** metade da base (Leandrinho) não paga nada, e o único cliente pagante veio da agência. Não há nenhuma prova de que alguém de fora compra por qualquer preço. "Justo" é uma pergunta inútil. A pergunta certa é: **quantas horas cada cliente consome?** Cronometre a DSC por 30 dias antes de mexer em qualquer número.

**Veredito:** mantenha a tabela atual e cobre a implantação de verdade. Baixar o preço com dois clientes e um deles isento é otimizar uma demanda que ainda não foi provada.

### O Pensador de Primeiros Princípios

**A pergunta está errada.** "Qual preço é justo?" supõe que o custo que importa é o da conversa, e não é. A IA custa R$1,24 por conversa. A DSC custa R$270/mês para gerar R$2.000. Esse custo é ruído. **O recurso escasso é a hora do João**, e ninguém mediu isso.

Reconstruindo do zero:

**1. Capacidade, não custo.** Um fundador solo que também toca agência consegue sustentar quantas lojas com onboarding, suporte e incidentes? Chuto uns 10 a 15 antes de travar. Se a meta for R$25 mil/mês líquidos com 12 lojas, o ticket médio precisa ficar perto de **R$2.000**. Com o bot a R$697, ele precisaria de 35 lojas, o que é impossível sozinho. O preço baixo do conselho anterior quebra o João.

**2. Conta por cliente a R$1.997 (250 conversas):** IA R$310, imposto de ~10% R$200, cartão de ~3% R$60, rateio fixo R$30. Sobram cerca de **R$1.400**, que pagam umas 10 horas do mês dele. A R$697 sobram uns R$450, ou seja, 3 horas. Um único incidente de "bot mudo" já come isso.

**3. "Conversas" é a unidade errada.** O plano cobra pelo item que quase não custa nada e que o lojista não valoriza. Ele valoriza carro vendido e lead que não esfriou de madrugada. O limite pode existir, mas como proteção, não como vitrine.

**4. O custo real é a implantação.** O WhatsApp oficial leva de 8 a 20 horas de armadilha. R$497 é dar isso de graça. O certo é **R$1.500 a R$2.500**, com a garantia atrelada ao bot respondendo, não ao resultado de vendas.

**5. A vantagem que ninguém usou:** ele é a agência que traz o lead. Bot sem tráfego vale pouco, e tráfego sem bot desperdiça lead. O preço justo é o **pacote**. Bot + CRM a ~R$1.997, sozinho, é "caro". Dentro de um contrato de gestão de anúncios, vira o que faz o anúncio dar retorno.

Antes de mexer em qualquer número, ele precisa marcar o tempo gasto em cada cliente durante 30 dias.

### O Expansionista

**A pergunta errada é "quanto cobrar pelo software"; a certa é quanto vale fechar o ciclo anúncio → conversa → venda.**

Comece pela margem que você já tem. A DSC paga R$2.000 e custa uns R$270 de variável, o que dá cerca de 86% de margem bruta antes das suas horas. No Essencial, cada conversa custa R$1,24 e você cobra perto de R$15 por ela. Não precisa baixar preço. O conselho anterior, ao cortar a entrada para R$697, troca margem por volume que um fundador solo nem consegue atender.

Você tem uma vantagem que nenhum CRM de revenda tem: é **agência Meta e dono do bot ao mesmo tempo**, com a captura do `ctwa_clid` já no ar. Só você consegue provar que o anúncio virou conversa, a conversa virou visita e a visita virou venda. Isso não se cobra como SaaS, se cobra como resultado.

Proposta:

- **Amply Completo (anúncio + bot + CRM):** R$3.500 a R$4.500 por mês, mais **R$200 a R$300 por venda atribuída**. Um seminovo deixa alguns milhares de margem para a loja, então R$250 é troco. A DSC já fechou venda pelo bot. Com 8 vendas no mês, ela paga uns R$6.000 e ainda acha barato.
- **Implantação: R$1.997, não R$497.** O onboarding do WhatsApp oficial é difícil, e é isso que te protege da concorrência. Cobre pelo trabalho, com garantia de 30 dias.
- **Excedente:** passou do limite, R$4 por conversa. O "avisa e nunca corta" continua, mas deixa de sair de graça. É cobrar mais de quem já está lucrando com você.
- **Leandrinho isento:** vire o jogo. Mostre os disparos que viraram venda e ofereça o bot com 60 dias pela metade.

Se der mais certo que o esperado:

1. **Grupos com várias lojas.** Uma implantação só, cobrança por CNPJ.
2. **Feed de estoque agregado.** Com 30 lojas, você tem um portal regional próprio e não depende de Webmotors.
3. **Financiamento.** A intenção que você já captura vira comissão de banco quando houver volume.

O teto aqui não é R$2.497. É uma parte de cada carro vendido.

### O Outsider

Sou o dono da loja lendo a sua tabela e já tropeço na primeira linha. **O que é uma "conversa"?** Um cliente? Uma mensagem? Um dia de papo com o mesmo cara? Não sei estimar se a minha loja tem 100 ou 400. Se eu não consigo prever o tamanho, escolho o plano mais barato. Ou pior: não escolho nenhum.

A frase "o limite avisa e nunca corta" me diz que os planos não valem nada. Se o Essencial nunca corta, por que eu pagaria R$2.497? Do lado de fora, isso lê como "pague o mínimo". Você mesmo matou a sua escada de preço.

E a conta que você trouxe mostra o seguinte: **a conversa não é o seu custo.** 500 conversas custam uns R$620. Mesmo no plano de R$2.497 sobra muito. Você está cobrando por faixas de uma coisa que quase não te custa nada. O que te custa caro são as suas horas no onboarding e no suporte, e isso não aparece em nenhuma linha da tabela. Você não vai quebrar com cliente que conversa muito. Vai quebrar com cliente que dá trabalho, e esse cliente paga o mesmo.

Para a pergunta "quanto é justo?", olhando de fora:
- **Uma taxa de implantação de verdade**, de R$1.500 a R$2.500, cobrindo os dias de WABA e token. Quem paga para entrar também fica mais tempo.
- **No máximo 2 planos**, separados por algo que eu entendo: "1 número" ou "WhatsApp + Instagram", "1 vendedor" ou "equipe". Nada de contagem de conversa.
- **Uma frase que eu, lojista, entendo**: "atende seu cliente às 2 da manhã e marca a visita". Termos como coexistência, template e WABA eu não sei o que são, e não deveria precisar saber.

Uma última coisa óbvia de fora: hoje você tem **um** cliente pagante. O outro é isento. Nenhuma tabela foi testada. Não existe preço "justo" calculado no papel. Ele aparece quando uns três lojistas desconhecidos dizem sim ou não para um número. Ofereça R$1.497 mais a implantação para três lojas que não te conhecem da agência e conte quantas fecham.

### O Executor

**A conta, por cliente com bot, sem enrolação:**
- IA: R$1,24 por conversa. 150 conversas dão R$186 e 400 dão R$496.
- Imposto + Asaas: uns 13% da mensalidade.
- Custo fixo dividido entre os clientes: uns R$50 cada, e cai conforme entra cliente.
- **Suas horas: R$600 por mês** (4h de suporte a R$150/h). Esse é o custo que ninguém está pondo na conta.

**Tabela que fecha:**
- **CRM sem bot: R$497.** Quase não te custa nada; é a porta de entrada.
- **Bot 150 conversas: R$1.497.** Sobram uns R$470 de margem.
- **Bot 400 conversas: R$1.997.** Sobram uns R$590.
- **Conversa a mais: R$3 cada.** "Avisa e nunca corta" pode continuar, mas cobrando. Do jeito que está, uma loja com 800 conversas te dá prejuízo.
- **Implantação: R$1.500, sem desconto.** É o seu dia e meio lutando com WABA, token e coexistência. Se você der de graça, cada cliente novo começa no vermelho. A garantia vale para a mensalidade, não para a implantação.

O R$697 do conselho anterior paga a IA e não paga você. Corta.

**Segunda de manhã, nesta ordem:**
1. **10 min:** veja a fatura nova da Placa Fipe e a taxa real do Asaas. Para de chutar.
2. **Planilha de horas, hoje.** Toda vez que mexer na DSC ou no Leandrinho, anote os minutos. Daqui a 30 dias você troca o meu "R$600" pelo número real e reajusta a tabela.
3. **Leandrinho "isento" acaba.** Liga e propõe R$497 a partir do mês que vem. Cliente de graça come o mesmo suporte que cliente pagante.
4. **DSC fica como está.** R$2.000 com 218 conversas está dentro da tabela, não mexe em quem paga.
5. **Até sexta:** pega 5 lojas da carteira da agência e oferece o Bot 150 com a prova da DSC (a primeira venda feita pelo bot, em 27/08). Sem prova não vende nem por R$697. Com prova, R$1.497 é menos que um vendedor de R$2.500.

O número certo não sai de pensar mais. Sai dessa planilha de horas e de 5 propostas na rua.

---

## Revisão cruzada

**Mapeamento do anonimato:** A = Executor · B = Expansionista · C = Contrarian · D = Primeiros Princípios · E = Outsider

Placar: **mais forte** → C (Contrarian) 2 · A (Executor) 2 · D (Primeiros Princípios) 1. **Maior ponto cego** → B (Expansionista) 5 de 5.

### Revisor 1
**1. A mais forte é a C.** É a única que faz a conta inteira de margem: R$697 − IA − imposto − cartão − fixo deixa ~R$450, e 3h de suporte comem isso. Ela também amarra essa conta a um teto físico de ~12 a 15 lojas, o que obriga o preço por cliente a ser alto. E ataca as três armadilhas concretas: implantação a R$497, "nunca corta" como cheque em branco e CRM a R$397 com o mesmo suporte. A D chega quase lá e acrescenta o pacote com a agência. A A é a mais acionável.

**2. O maior ponto cego é da B.** Ela cobra R$3.500 a 4.500 mais R$200 a 300 por venda atribuída, mas a atribuição ainda não existe. Hoje só se captura o `ctwa_clid`, sem tela e sem envio. E a atribuição por telefone já falhou na primeira venda, porque quem comprou foi outra pessoa da casa. Cobrar por venda vira disputa mensal com o lojista. Além disso, ninguém pagou nem a tabela atual ainda.

**3. O que todas deixaram passar:** elas tratam a hora do João como custo fixo a repassar no preço, e não como custo a derrubar. O onboarding manual do WhatsApp e os incidentes silenciosos (bot calado) são problemas de produto. Automatizar o cadastro e o alarme muda a margem mais do que qualquer faixa de preço. Faltou ainda o risco de depender de uma pessoa só: o que o contrato promete quando o João não está disponível?

### Revisor 2 (ângulo: contradição com o conselho anterior; plausibilidade das horas)
**1. Mais forte: A.** É a única que faz a conta de margem por plano e termina com ações para segunda-feira. A C chega ao mesmo diagnóstico, o de que o custo é a hora do João e não a IA, e acerta ao dizer que o CRM a R$397 é armadilha. Só que a C não fecha a tabela.

**2. Maior ponto cego: B.** O cliente já reclama que é "caro", e a B propõe R$3.500–4.500 mais comissão por venda atribuída. Essa comissão depende de uma atribuição que ainda não existe: o `ctwa_clid` é capturado, mas falta a tela e falta o envio. E na primeira venda a atribuição por telefone já falhou, porque quem comprou foi outra pessoa da casa. A B cobra por uma prova que o produto ainda não entrega.

**Sobre as horas:** os "4h/mês a R$150/h" da A são inventados. Ninguém mediu nada, e os incidentes de outubro na DSC sugerem bem mais que 4h. C e D acertam em mandar cronometrar 30 dias antes de cravar número.

**3. O que todas deixaram passar:**
- **Implantação de R$1.500–2.500 (A, C, D, E) contradiz o conselho anterior.** O "caro" já é a objeção, e isso aumenta a barreira de entrada. A saída é diluir: implantação zero com fidelidade de 12 meses, cobrada só se a loja cancelar antes. A C citou isso de passagem.
- **O disparo cai no cartão da loja.** O preço que o lojista sente é a mensalidade mais a Meta.
- **O único preço validado é o da DSC, ~R$2.000.** A tabela nunca foi vendida, então o "caro" é hipótese, não dado. Só o teste da E separa uma coisa da outra.

### Revisor 3 (ângulo: horas recorrentes vs. pontuais; câmbio)
**1. Mais forte: C**, com o ajuste de pacote de D. C é a única que faz a conta inteira do plano de R$697 e mostra quanto sobra (~R$450). Também derruba os dois erros caros do conselho anterior: implantação a R$497 e CRM a R$397. D chega à mesma conclusão e acrescenta o melhor argumento de venda: o bot sozinho parece caro, mas dentro do contrato de anúncios é o que faz o anúncio dar retorno.

**2. Maior ponto cego: B.** Pede R$3.500–4.500 mais R$200–300 por venda atribuída sem ter vendido nenhum plano. E a atribuição ainda não funciona: falta a tela e o envio para a Meta, e a ligação pelo telefone falha quando quem compra é outra pessoa da casa. Cobrar por venda atribuída hoje gera briga com o cliente, não receita.

**3. O que todas deixaram passar:**
- **As horas não são recorrentes.** A (R$600/mês) e D (meta de ticket) tratam as horas como custo mensal eterno. A maior parte é onboarding, que acontece uma vez, e incidente, que é falha do produto. O onboarding se paga com a implantação e cai se for automatizado. O incidente se resolve estabilizando o produto. Cobrar isso na mensalidade é fazer o cliente pagar pelos seus bugs.
- **Cronometrar a DSC (C, D) dá um número viciado.** Ela passou pelos incidentes de outubro. É o pior caso, não a média.
- **Câmbio e troca de modelo.** A IA é paga em dólar e o preço é em real. Trocar de modelo pode dividir ou multiplicar os R$1,24 por conversa. Falta no contrato uma cláusula de reajuste ligada ao custo, e o excedente de R$3–4 precisa de folga para isso.

### Revisor 4 (ângulo: o que é justo para o lojista; fidelidade)
**1. A mais forte é a D.** Ela olha para o recurso que realmente acaba, que são as horas do João, e chega a um ticket médio de cerca de R$2.000. Também é a única que trata o bot como parte do contrato de anúncios, e é aí que o preço fica justo para o lojista. A C chega quase no mesmo lugar, mas tem menos visão de produto.

**2. O maior ponto cego é o da B.** Pede R$3.500–4.500 mais comissão por venda sem nenhum cliente pagante e sem medir a atribuição, que hoje falha quando outra pessoa da casa compra (caso da DSC). A A erra no sentido oposto: monta a planilha de custo, mas não pergunta quanto vale para a loja.

**3. O que todas deixaram passar:**
- **A conta do lojista.** Um vendedor custa mais de R$2.500 mais comissão. Na DSC, uma venda de carro rende alguns milhares de margem. Se o bot gera uma venda por mês a mais, R$1.997 já se paga. Isso é o que o lojista enxerga, e nenhuma delas fez essa conta.
- **Fidelidade de 12 meses.** Ela permite cobrar a implantação de R$1.500–2.500 em 3–6 parcelas, ou abrir mão dela em troca do contrato. A barreira de entrada cai sem mexer na mensalidade.
- **Cancelamento.** Ninguém pensou no que acontece se a loja sai no terceiro mês, depois de ter consumido as horas do onboarding.

### Revisor 5 (ângulo: aritmética; custo de oportunidade)
**1. A mais forte é a A.** É a única cujas contas fecham. No Bot 150: R$1.497 − 186 (IA) − 195 (13%) − 50 (fixo) − 600 (horas) = R$466. No Bot 400: R$1.997 − 496 − 260 − 50 − 600 = R$591. Ela também põe as horas do João na conta e termina com ações concretas. Tem uma falha: com as mesmas 4h a R$150, o CRM a R$497 dá prejuízo (497 − 65 − 50 − 600 ≈ −R$218).

**2. O maior ponto cego é da B.** Os "86%" (2.000 − 270) ignoram imposto, cartão e horas. Descontando só o imposto, a margem cai para uns 73%. E ela propõe R$3.500–4.500 sem nenhuma venda que sustente o valor.

Contas que não fecham nas outras:
- **D:** 12 lojas × R$1.400 de sobra = R$16,8 mil, não R$25 mil. Para R$25 mil líquidos, cada loja precisa deixar ~R$2.083, o que pede um ticket bruto perto de R$2.700, não R$2.000.
- **C:** 15 × R$1.497 dá R$22,5 mil, não R$25 mil. E é receita bruta tratada como teto.

**3. O que todas deixaram passar:** o custo de oportunidade.
- A hora do João não vale R$150 por chute. Vale o que ela renderia na agência. Se uma hora na agência rende R$250, a margem do CRM é negativa e cada loja nova toma o lugar de um cliente de anúncios.
- Ninguém separou a implantação, que é uma vez só, do suporte, que é todo mês.
- Ninguém perguntou em que anexo do Simples o João cai (III ou V, pelo fator R). Isso pode tirar até ~10 pontos de margem.

---

## Veredito do presidente

### Onde o conselho concorda

- **A hora do João é o custo que decide.** A IA custa R$1,24 por conversa, cerca de R$270 por mês na DSC. É pouco e é previsível. As horas são o custo grande, e ninguém as mediu.
- **A implantação precisa ser cobrada.** O onboarding do WhatsApp oficial leva de 8 a 15 horas. A R$497, ele vira prejuízo antes da primeira mensalidade.
- **"Nunca corta" precisa de um preço de excedente.** Sem ele, o limite é um cheque em branco e a escada de planos não faz sentido.
- **CRM barato é armadilha.** Gera o mesmo suporte por uma fração do preço. Com 4 horas a R$150/h, o CRM a R$497 dá prejuízo de cerca de R$218 por mês (497 − 64,61 − 50 − 600 = −217,61).
- **Quem decide o preço é a medição e o mercado, não a planilha.**

### Onde o conselho diverge

- **Nível da tabela.** O Contrarian quer manter a tabela atual. O Executor quer baixar a entrada e subir a franquia de conversas.
- **Quando cobrar a implantação.** Há quem queira R$1.500–2.500 à vista e há quem queira diluir em fidelidade.
- **Como separar os planos.** Executor e Contrarian separam por faixa de conversas. O Outsider separa por algo que o lojista entende: um número ou WhatsApp + Instagram, um vendedor ou uma equipe.
- **Ambição.** O Expansionista quer vender o pacote "anúncio + bot + CRM" a R$3.500–4.500 mais comissão por venda. Foi descartado por unanimidade.

### Pontos cegos que a revisão pegou

1. **Nem toda hora é recorrente.** Onboarding acontece uma vez e se paga com a implantação. Incidente é falha do produto e se resolve estabilizando o sistema. Pôr isso na mensalidade é fazer o cliente pagar pelos bugs.
2. **Implantação cara contradiz o conselho anterior**, que concluiu que "caro" é a objeção. A saída é a fidelidade.
3. **A conta do lojista nunca foi mostrada.** Um vendedor custa R$2.500 mais comissão, e uma venda a mais por mês paga o plano.
4. **Faltam proteções:** não há cláusula de reajuste por câmbio e o anexo do Simples pode mudar cerca de 10 pontos de margem.
5. **O lojista sente dois custos:** a mensalidade e os disparos da Meta no cartão dele.
6. **Não existe contrato para quando o João não está.** Não há promessa de suporte escrita.
7. **O único preço validado é o da DSC (~R$2.000).**

### A recomendação

**(a) Tabela.** São dois planos de bot, separados pelo que o lojista entende. A franquia de conversas fica só como proteção, não aparece como vitrine.

| Plano | Mensalidade | Implantação | Franquia / excedente |
|---|---|---|---|
| CRM (sem bot) | R$597 | R$497 | — |
| Bot (1 WhatsApp, até 2 vendedores) | R$1.497 | R$1.500 | 300 conversas; R$3 cada a mais |
| Bot Completo (WhatsApp + Instagram, equipe) | R$1.997 | R$1.500 | 600 conversas; R$3 cada a mais |

No excedente, cada conversa extra deixa R$1,37: 3,00 − 0,39 de imposto e cartão − 1,24 de IA.

**(b) Margem por plano.** Premissas, todas hipóteses:

- 13% de imposto + cartão;
- R$50 de custo fixo rateado por cliente;
- IA a R$1,24 por conversa;
- horas recorrentes de 1h, 2h e 3h por mês, a R$150/h;
- onboarding fora da conta, porque a implantação paga.

| Plano | Mensalidade | − 13% | − IA | − fixo | − horas | Margem |
|---|---|---|---|---|---|---|
| CRM | 597 | 77,61 | 0 | 50 | 150 | **319,39** |
| Bot, 220 conversas (típico) | 1.497 | 194,61 | 272,80 | 50 | 300 | **679,59** |
| Bot, 300 conversas (franquia cheia) | 1.497 | 194,61 | 372,00 | 50 | 300 | **580,39** |
| Completo, 400 conversas | 1.997 | 259,61 | 496,00 | 50 | 450 | **741,39** |
| Completo, 600 conversas (franquia cheia) | 1.997 | 259,61 | 744,00 | 50 | 450 | **493,39** |

Conferência da linha do Bot típico: 1.497 − 194,61 = 1.302,39; menos 272,80 = 1.029,59; menos 50 = 979,59; menos 300 = **679,59**.

Os planos ficam positivos mesmo com a franquia cheia. Um cliente que tome 3 horas a mais do que o previsto (R$450) ainda não leva nenhum plano ao prejuízo.

> **Nota do relator (conferência pós-síntese):** a última frase está errada para o plano CRM. Com 3 horas a mais (R$450), a margem do CRM cai de R$319,39 para **−R$130,61**. Para os planos de bot ela vale: o Bot com a franquia cheia fica em R$130,39 e o Completo com a franquia cheia fica em R$43,39. Todas as outras contas da tabela foram conferidas e fecham.

**(c) Como conciliar com "caro" sem baixar a mensalidade.**

- **Implantação zerada com fidelidade de 12 meses.** Só é cobrada, proporcionalmente, se o cliente cancelar antes. Sem fidelidade, sai por R$1.500 em 3x.
- **Garantia de 30 dias:** "se o bot não estiver respondendo seus leads, a primeira mensalidade é por nossa conta."
- **Mostrar a conta do lojista** e a prova da DSC: um vendedor custa R$2.500 mais comissão, e a primeira venda pelo bot entrou pelo Celta e fechou no Sandero. Uma venda a mais por mês paga o plano várias vezes.
- **Bônus para quem já é cliente da agência:** o bot é o que faz o anúncio virar venda.

O preço continua o mesmo. O que muda é que a barreira de entrada vai a zero e o risco passa para a Amply.

**(d) DSC e Leandrinho.**

- **DSC:** fica no Bot Completo a R$1.997, praticamente o que já paga. Ofereça a fidelidade de 12 meses com cláusula de reajuste anual por câmbio.
- **Leandrinho:** a isenção acaba. Avise com 30 dias e passe para o CRM a R$597, sem implantação. Se ele recusar, isso também é informação útil.

**(e) Números que são hipótese e precisam virar dado medido:**

- R$150/h (comparar com quanto a hora rende na agência);
- 1h, 2h e 3h de suporte recorrente;
- 13% de imposto + cartão (confirmar o anexo do Simples e a taxa real do Asaas);
- R$50 de fixo rateado (somar as faturas reais, incluindo a Placa Fipe);
- 220 e 400 conversas típicas;
- R$1,24 por conversa (oscila com o câmbio e com o modelo de IA).

Cronometre as horas por cliente durante 30 dias, separando onboarding, suporte e incidente. A DSC vai mostrar o pior caso, não a média. Se o suporte passar de 3h por mês, ou se a hora na agência valer mais de R$150, revise a tabela.

### A primeira coisa a fazer

Até sexta, junte numa página o caso da DSC (conversas, leads e a venda do Sandero) e ofereça o Bot a R$1.497, com implantação zerada mediante fidelidade de 12 meses, a 5 lojas da carteira da agência. Quantas aceitam é o único teste de preço justo que importa.
