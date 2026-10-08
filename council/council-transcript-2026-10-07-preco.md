# Conselho — "As pessoas estão achando caro" (2026-10-07)

## Pergunta original

> o que vcs acham que preciso melhorar nesse crm? pq as pessoas estão achando caro e tals

## Pergunta enquadrada

PERGUNTA: "O que preciso melhorar nesse CRM? As pessoas estão achando caro."

QUEM É: João, fundador solo da Amply (Brasil). Constrói o produto sozinho com IA e também gerencia anúncios Meta para clientes.

O PRODUTO: CRM + bot de IA para lojas de veículos (seminovos/motos). Estoque, leads, agenda, lista de espera, contrato de venda, custos do veículo, financeiro, consulta de placa/FIPE, feed de estoque para o site. Bot de IA no WhatsApp (API oficial, coexistência) e Instagram Direct: consulta o estoque ao vivo, manda fotos/vitrine, agenda visita, entende áudio, passa para humano. Disparos, aniversário, reengajamento, atribuição de anúncio Meta.

PREÇOS (mostrados só DEPOIS de criar conta; sem página pública de preço nem teste grátis — conferido em `src/views/EscolherPlano.jsx`):
- CRM (sem bot): R$800/mês
- Essencial: R$1.497/mês — até 100 conversas
- Crescimento: R$1.997/mês — até 250 conversas (selo "MAIS ESCOLHIDO")
- Performance: R$2.497/mês — até 500 conversas
- Personalizado: negociado
Limite avisa e nunca corta. Benefícios em linguagem de recurso.

CUSTO REAL: ~R$1,24 por conversa (Essencial cobra ~R$15 por conversa).

TRAÇÃO: 2 clientes "isentos", vindos da agência. DSC ~R$2.000 com bot (218 conversas/mês; 1ª venda atribuída em 27/08/2026, Celta → Sandero). Leandrinho Motos só CRM. Ninguém comprou pela tabela. Dashboard mostra faturamento, não o que o bot gerou. Selo "MAIS ESCOLHIDO" sem comprador.

MERCADO (aproximado, não verificado): sistemas de gestão de revenda custam centenas de reais; CRMs de WhatsApp genéricos têm planos de entrada mais baratos.

OBS: não se sabe exatamente quem disse "caro".

---

## Respostas dos conselheiros

### O Contrarian

**A falha fatal: você não sabe se o problema é preço.** "Estão achando caro" é boato. Não se sabe quem disse, em que momento, comparando com o quê. Ninguém comprou pela tabela, e ninguém foi recusado por ela de um jeito que você tenha registrado. Antes de mexer em produto ou preço, responda: quantos prospects viram a tabela? Quantos disseram não? O que disseram, palavra por palavra? Se a resposta for "uns três, numa demo", você está prestes a redesenhar o negócio em cima de três frases.

**"Caro" quase sempre quer dizer "não vi o retorno".** O seu painel mostra o faturamento da loja, mas não mostra o que o bot gerou. Você tem uma única venda atribuída, e a atribuição por telefone já falha quando quem compra é outra pessoa da casa. Você pede R$1.497 por algo que você mesmo não consegue provar dentro do produto. Sem o número de vendas que o bot trouxe, qualquer preço parece alto, até R$500.

**Sua tabela atrapalha a venda:**
- O selo "MAIS ESCOLHIDO" está num plano que ninguém escolheu. O lojista de seminovos vive de farejar conversa de vendedor, e esse selo cheira a isso.
- O limite avisa e nunca corta, então não há motivo real pra subir de plano. Na prática é um plano só, com três etiquetas de preço.
- O preço só aparece depois de criar a conta e não há teste grátis. Isso gera desconfiança antes de gerar valor.

**A pergunta que você está evitando:** os dois clientes vieram da sua agência. Talvez você não tenha um SaaS. Talvez tenha "agência + CRM", em que o software é o que segura o cliente e o anúncio é o que vende. Vendido sozinho, a frio, contra Kommo e sistemas de revenda de R$300, você disputa uma briga que ainda não provou poder ganhar.

**Faça antes de qualquer coisa:** coloque na tela "o bot gerou X leads e Y vendas este mês". Depois volte a três prospects que disseram "caro" e mostre isso. Se continuar caro, aí sim o problema é preço.

### O Pensador de Primeiros Princípios

**Você está fazendo a pergunta errada.** "O que melhorar no CRM" parte da ideia de que o problema é o produto. Ninguém comprou pela tabela, e você não sabe quem disse "caro" nem comparando com o quê. Antes de mexer em qualquer coisa, falta esse dado.

Voltando ao básico: dono de loja de seminovo não compra software. Ele compra carro vendido. "Caro" quer dizer só uma coisa: ele não viu o que ganha em troca. E hoje nada mostra isso pra ele. Sua tela de preço lista recursos ("atendimento automático", "retorno de conversões"). Recurso coloca você ao lado do Kommo e do sistema de gestão de R$300. Nessa comparação você perde, e vai continuar perdendo mesmo cortando metade do preço.

Pensa na conta do dono da loja. Um carro dá alguns milhares de reais de margem. Se o bot fechar uma venda a mais por mês, o Essencial se paga. Um vendedor custa mais de R$2.500 mais comissão e não responde às 23h de domingo. Esse é o concorrente certo, e você nunca coloca ele na mesa.

O pior é que você já tem a prova e esconde. A DSC vendeu um Sandero por um lead que entrou pelo Celta. Você tem a atribuição de anúncio pronta. Mesmo assim o painel mostra o faturamento da loja e não mostra o que o bot gerou. O cliente que paga não enxerga o retorno, e quem está avaliando não tem como acreditar nele.

Mais uma coisa: os dois clientes vieram da agência. Talvez o produto que vende de verdade seja "anúncio + bot que atende e fecha", e não um CRM vendido sozinho.

O que eu faria, nessa ordem:
1. Ligar pra quem disse "caro" e perguntar: "caro comparado com o quê?"
2. Construir a tela "vendas e leads que o bot gerou, em R$" antes de qualquer recurso novo.
3. Na tabela, trocar recurso por resultado (custo de vendedor contra custo do bot, carros fechados) e tirar o selo "MAIS ESCOLHIDO", que não é verdade.
4. Não baixar o preço antes de mostrar o valor.

### O Expansionista

"Caro" é o sintoma. O problema é que você vende um CRM quando tem nas mãos uma máquina de vender carro. Nenhum concorrente junta essas três peças: uma agência que gera o lead, um bot que atende e o retorno da venda pra Meta. A Kommo não tem isso, e o sistema de gestão de R$300 também não. Hoje você esconde esse diferencial atrás de cards que listam recurso.

**Vire o jogo de "mensalidade" para "participação na venda".** Uma conversa custa R$1,24. Cobre uma entrada baixa, entre R$500 e R$700, e mais uma taxa por venda atribuída ao bot, algo como R$150 a R$300 por carro. A DSC vende um Sandero e você recebe junto. O lojista com margem apertada não discute risco zero. E você ganha mais com quem cresce mais, sem teto artificial.

**O ativo escondido é o sinal de venda que volta pra Meta.** Uma campanha otimizada por venda real derruba o custo por lead. Isso é argumento de agência, não de software. Venda o pacote "anúncio + bot + atribuição" por um preço único e mostre o custo por carro vendido. Daí "caro" sai da conversa.

**O dashboard de ROI vale mais que qualquer desconto.** Coloque na tela, em letra grande: "O bot gerou X leads, Y visitas, Z vendas, R$W em faturamento". O preço passa a ser comparado com o valor gerado, e não com o Kommo.

**Tem um terceiro jogo maior.** Venda pra outras agências de tráfego automotivo, com a marca delas. Cada agência traz 10 a 30 lojas. Você não precisa vender loja por loja, e elas já sentem a dor de provar resultado pro cliente.

**A lista de espera de várias lojas é um ativo de rede.** Ela mostra demanda declarada por modelo e região. Com escala, isso vira inteligência de compra pro lojista ("compre Onix 2019, tem 14 pessoas esperando") e lead qualificado pra financeira. A Credere disse não pagar comissão, mas com volume essa conversa muda.

Não baixe o preço. Mude o que você está vendendo.

### O Outsider

Sou dono de loja e vejo isto pela primeira vez. "Caro" quer dizer que eu não entendi o que estou comprando.

**Eu não sei o que é uma "conversa".** Você me vende 100, 250, 500 conversas. Uma conversa é um cliente? Uma mensagem? Um dia de papo? Se o mesmo cliente volta amanhã, conta duas? Quando não sei medir a unidade, presumo que vou estourar. E "avisa e nunca corta" me soa como cobrança extra escondida, mesmo que não seja.

**Eu não vejo carro vendido.** Os cards dizem "retorno de conversões para os anúncios da Meta" e "identificação de quem atendeu cada cliente". Não entendi nenhum dos dois. Eu vendo carro. Quero ler "o robô responde às 23h de domingo, manda as fotos do Onix e marca a visita". E quero ver isso acontecer na minha frente, no meu WhatsApp, com o meu estoque.

**Você me pede R$1.500 sem me deixar ver o preço nem testar.** Primeiro tenho que criar conta, depois aparece a tabela, e não existe teste grátis. Parece armadilha. O selo "mais escolhido" num plano que ninguém escolheu eu não sei que é falso, mas sinto que é papo de vendedor.

**Comparo com o que já conheço.** Meu sistema de estoque custa umas centenas de reais. Na minha cabeça você é "um sistema mais caro", não "um vendedor que não dorme". Você nunca me deu outra régua para comparar.

**Cadê a prova?** Você tem uma venda: o cliente entrou pelo Celta e levou o Sandero. Essa é a melhor coisa que você tem e não aparece em lugar nenhum. Nem o seu cliente atual vê no painel quantos carros o robô vendeu para ele.

O que eu mudaria antes de mexer em preço:

1. Trocar "conversas" por "clientes atendidos por mês".
2. Escrever os benefícios em carros vendidos e em horas que eu economizo.
3. Mostrar no painel "o robô trouxe X vendas este mês".
4. Deixar 14 dias de teste no meu WhatsApp.

Com a venda à vista, R$1.500 vira barato. Sem ela, qualquer preço parece caro.

### O Executor

Você não tem um problema de preço. O que falta é prova de que o produto se paga. "Caro" quer dizer "não vi o retorno". Baixar a tabela é a resposta errada e mexer no produto também. O conserto leva uma semana.

**Segunda de manhã:** abra o banco da DSC e conte os leads que o bot atendeu, as visitas que agendou e as vendas que gerou. Você já tem a venda do Sandero atribuída. Monte um caso de uma página: "R$2.000/mês, X conversas atendidas fora do horário, Y visitas, Z vendas. Uma venda paga N meses." Ligue para o dono da DSC e peça uma frase de depoimento.

**Terça e quarta:** ponha no Dashboard um card com "Vendas geradas pelo bot" e "Retorno do mês". A atribuição já existe, então é uma consulta e um componente. É isso que transforma mensalidade em investimento, e é o que você mostra na demonstração.

**Quinta:** troque o texto dos cards. Hoje está escrito "Atendimento automático no WhatsApp". O certo é "Responde o lead às 23h e agenda a visita". Tire o selo "MAIS ESCOLHIDO", porque ninguém escolheu esse plano. Publique a página de preços antes do cadastro, porque esconder o preço passa a ideia de que é caro.

**Sexta:** crie a oferta de entrada sem mexer na tabela. São 30 dias com o bot por R$497 de implantação, e você só cobra a mensalidade se aparecerem visitas agendadas. Seu custo real é R$1,24 por conversa, então esse teste custa uns R$150 para você. O risco é baixo e fecha cliente.

**Semana seguinte:** pegue os prospects que acharam caro e mostre o caso da DSC junto com a oferta. Meta: 3 conversas e 1 fechamento.

Você também tem uma vantagem que ainda não usa: os clientes chegam pela sua agência. Venda anúncio e bot no mesmo pacote. Quem já paga para gerar lead entende na hora por que precisa de quem atenda esse lead.

Se depois de 10 demonstrações com o caso de ROI na mão todo mundo ainda achar caro, aí sim você revê a tabela, com dados em vez de achismo.

---

## Revisão cruzada

**Mapeamento do anonimato:** A = Outsider · B = Contrarian · C = Executor · D = Expansionista · E = Primeiros Princípios

Placar: **mais forte** → C (Executor) 4 votos, B (Contrarian) 1 voto. **Maior ponto cego** → D (Expansionista) 5 de 5.

### Revisor 1
**1. A mais forte: C.** É a única que vira trabalho na segunda-feira, com dados que o João já tem: tirar do banco da DSC os leads, as visitas e as vendas do bot, montar um caso de uma página, colocar um card de ROI no painel e reescrever os cards. Também tem trava: só mexer na tabela depois de 10 demos com o caso na mão. B diagnostica melhor ("caro" é boato), mas para no diagnóstico.

**2. O maior ponto cego: D.** Ela propõe cobrar por venda atribuída, mas a atribuição é justamente o ponto mais frágil do sistema. Até hoje houve uma única venda atribuída, e ela já foi por outro carro. A atribuição por telefone falha quando quem compra é outra pessoa da casa. Na prática, D entrega a receita a uma métrica que o lojista contesta. Também sugere revenda com marca da agência e inteligência de mercado a um fundador solo com 2 clientes.

**3. O que todas deixaram passar:** a DSC usa 218 conversas por mês e paga cerca de R$2.000. Isso é praticamente o Crescimento (R$1.997, 250 conversas) pelo preço de tabela. O único cliente de bot já valida o preço. Então o problema não é o valor, é a venda a frio, que nunca foi testada. A pergunta que falta é se a própria DSC renovaria sem a agência junto. E nenhuma notou que, a ~R$1,24 por conversa, a margem permite um teste grátis sem risco nenhum.

### Revisor 2 (ângulo: confiabilidade da atribuição, risco do teste grátis)
**1. Mais forte: B.** É a única que duvida do diagnóstico ("caro" é boato, ninguém mediu nada) e que aponta o defeito que derruba o resto: a atribuição por telefone falha quando quem compra é outra pessoa da casa. C vem logo atrás pela execução concreta, mas trata a contagem de vendas no banco da DSC como fácil, e não é.

**2. Maior ponto cego: D.** A cobrança por venda atribuída depende de um rastreamento que hoje registra 1 venda. O resultado seria briga com o lojista e receita perto de zero. O white-label para agências multiplica o onboarding da Meta para um fundador sozinho. O teste grátis de A (14 dias) e de C (30 dias) tem o mesmo problema: WABA, coexistência e verificação podem comer o prazo inteiro, e o teste acaba antes de o bot responder a primeira mensagem.

**3. O que todas deixaram passar:**
- **A tela de ROI pode piorar a percepção.** Com atribuição fraca, ela vai mostrar "0 vendas" na maioria dos meses. O painel deve começar pelo que já dá para medir com segurança: clientes atendidos fora do horário, tempo de resposta, fotos enviadas, visitas agendadas. Junto disso, um botão "esta venda veio do bot" para o vendedor marcar.
- **Em vez de teste grátis, implantação paga.** O fundador controla o onboarding e o cliente assume compromisso.
- **A DSC já usa 218 conversas.** O comportamento real dela é o melhor dado de preço disponível, e ninguém usou.
- **A margem não é o problema.** A ~R$1,24 por conversa sobra espaço para ajustar a oferta sem mexer no preço.

### Revisor 3 (ângulo: estrutura da tabela)
**1. A mais forte é a C.** É a única que vira trabalho com prazo e usa um dado que você já tem no banco da DSC. A oferta dela cobra por visitas agendadas, que o próprio bot marca e registra, então a loja não consegue esconder o resultado. A B tem o melhor diagnóstico ("caro é boato"), mas para no diagnóstico.

**2. O maior ponto cego é o da D.** Ela propõe cobrar por venda atribuída, mas quem registra a venda é a loja, e ela ganha dinheiro deixando de registrar. A atribuição por telefone já falha hoje (o lead entrou pelo Celta e a compra foi do Sandero, e às vezes quem compra é outra pessoa da casa). Em meses houve uma venda atribuída, o que dá uma receita perto de zero e cheia de discussão. O white-label para agências também não cabe para um fundador sozinho com 2 clientes.

**3. O que todas deixaram passar foi a escada de preço.**
- O CRM de R$800 sem bot é o único plano comparável aos sistemas de algumas centenas de reais, e perde nessa comparação. O "caro" pode ser ele, e o Leandrinho só usa o CRM.
- Não existe plano de bot sozinho nem plano de entrada. O bot custa R$697 a mais.
- Entre os planos com bot, cada degrau de R$500 traz 150 ou 250 conversas a mais, que custam uns R$186 ou R$310 (a ~R$1,24 cada). Os degraus são arbitrários.
- Como o limite nunca corta, não há motivo para subir de plano.
- A margem é enorme (100 conversas custam uns R$124). Dá para fazer um bot de entrada a R$497 e cobrar o excedente por conversa.

### Revisor 4 (ângulo: processo de venda e confiança)
**1. Mais forte: C.** É a única que transforma o diagnóstico em ação com dados que você já tem: o banco da DSC, o caso Celta→Sandero e o painel. B e E acertam o diagnóstico, mas param na tese. O ponto fraco de C é a oferta "só cobra se agendar visita". Ela te deixa com o risco sem que você controle a operação da loja.

**2. Maior ponto cego: D.** D cobra por venda atribuída, mas a sua atribuição já falhou no único caso real: quem comprou foi outra pessoa da casa. Cobrança por venda vira discussão sobre cada carro. Propor white-label para agências também ignora que você é um fundador sozinho, sem estrutura para dar suporte a 30 lojas.

**3. O que todas deixaram passar:** o processo de venda e a confiança.
- **Quem vende e como?** Hoje só você, pela agência. A frio, ninguém fez demo.
- **O lojista nunca vê o bot respondendo com o próprio estoque, no próprio WhatsApp, antes de pagar.** O feed de estoque já permite uma demo ao vivo de 10 minutos com os carros dele. Isso vale mais que teste grátis.
- **"Caro" costuma ser um "não confio" dito com educação:** marca nova, fundador solo, "e se cair?". O sistema já caiu e o bot já ficou calado sem dar erro. Venda garantias: o número continua dele, dá para cancelar quando quiser, há alarme de conversa parada e você responde quando der problema. Mostre também o que o bot **não** fala, que é o medo de ele inventar preço.

### Revisor 5 (ângulo: margem e público)
**1. A mais forte é a C.** É a única que usa o custo real. A oferta dela tem risco controlado: 30 dias de bot custam uns R$150, contra R$497 de implantação. E ela deixa para mexer na tabela só depois de 10 demonstrações, o que evita mexer no preço sem saber se o problema é preço. A B diagnostica bem, mas para no diagnóstico.

**2. O maior ponto cego é da D.** Ela propõe cobrar por venda atribuída, mas a atribuição já falhou na única venda que existe: o lead entrou pelo Celta e quem comprou o Sandero pode ter sido outra pessoa da casa. Cobrar por venda vira briga mensal sobre quem vendeu, e quem perde é o fundador sozinho.

**3. O que todas deixaram passar:**
- **A margem.** O custo é R$1,24 por conversa e o Essencial cobra uns R$15 (R$1.497 por 100). Há muito espaço para um plano de entrada por R$300 a R$500 sem dar prejuízo. Nenhuma calculou isso. Além disso, vender por "conversa" convida o lojista a dividir o preço e sentir que paga R$15 por "oi".
- **O público.** O bot só vale se entram conversas, e conversa vem de anúncio. Uma loja pequena sem tráfego pago não chega a 100 conversas por mês, então para ela o produto é caro mesmo. O público certo é a loja que já investe em Meta, que no fundo é o cliente da agência.
- **A amostra.** São 2 clientes, os dois com preço negociado. Ainda não se sabe quanto o mercado aceita pagar, então "caro" não diz se o problema é o preço ou o comprador.

---

## Veredito do presidente

### Onde o conselho concorda

O problema principal não é o valor. "Caro" é o que o lojista diz quando não vê o retorno ou não confia em quem está vendendo. Quatro dos cinco conselheiros chegaram a isso por caminhos diferentes, e o Executor ganhou a revisão porque transformou o diagnóstico numa semana de trabalho.

Os pontos de consenso:
- **A prova existe, mas está escondida.** O bot atende de madrugada, manda fotos, agenda visita, e já houve o caso do Sandero. Nada disso aparece no painel, nem para a DSC, que já paga.
- **A tabela atrapalha a venda.** Os cards falam de recurso e colocam você ao lado de Kommo e de sistemas de gestão de centenas de reais. O selo "MAIS ESCOLHIDO" não tem nenhum comprador. Preço só depois do cadastro e sem teste parece armadilha.
- **A régua de comparação está errada.** O concorrente certo é o vendedor que custa R$2.500 mais comissão e não responde domingo às 23h. Um carro a mais por mês paga qualquer plano.
- **Não baixar o preço antes de mostrar valor.**

### Onde o conselho diverge

- **Preço por resultado ou mensalidade.** O Expansionista propõe entrada baixa mais R$150–300 por venda atribuída. O Executor propõe mensalidade condicionada a visitas agendadas. Os outros não mexem no modelo.
- **Teste grátis.** O Outsider quer 14 dias grátis. O Executor quer implantação paga.
- **O tamanho do diagnóstico.** O Contrarian questiona até se existe venda a frio. Os outros já partem para consertar a oferta.

### Pontos cegos que a revisão pegou

1. **A DSC valida o preço.** Ela paga cerca de R$2.000 por 218 conversas, o que é praticamente o Crescimento pela tabela. O que nunca foi testado é a venda a frio, sem a agência no meio.
2. **Uma tela de ROI ingênua piora a percepção.** Com a atribuição atual, ela vai mostrar "0 vendas" na maioria dos meses.
3. **Cobrar por venda não funciona.** Quem registra a venda é a loja, e ela ganha deixando de registrar. Isso vira briga todo mês.
4. **Teste grátis de 14 dias morre no onboarding.** WABA, coexistência e verificação podem consumir o prazo inteiro antes de o bot responder a primeira mensagem.
5. **O "caro" pode ser o plano CRM de R$800.** É o único plano comparável aos sistemas de centenas de reais, e perde nessa comparação. E não existe plano de entrada com bot.
6. **"Conversa" é uma unidade ruim.** O lojista divide o preço e sente que está pagando R$15 por um "oi".
7. **Loja sem tráfego pago não chega a 100 conversas por mês.** Para ela o produto é caro de verdade, e ela não é o seu público.

### A recomendação

**PRODUTO (prioridade 1)**
1. Criar o card "O que o robô fez este mês" no Dashboard, só com o que dá para medir com segurança: clientes atendidos fora do horário, tempo médio de resposta, fotos enviadas, visitas agendadas.
2. Colocar no lead o botão **"Esta venda veio do robô"** para o vendedor marcar. A atribuição automática fica como bônus, não como métrica principal.
3. Mostrar a confiabilidade como recurso: o número continua da loja, o alarme de conversa parada existe, e há uma lista clara do que o bot não fala (preço sem estoque, condição de financiamento).

**TABELA E OFERTA (prioridade 2)**
1. Publicar o preço numa página aberta, antes do cadastro.
2. Trocar "conversas" por **"clientes atendidos por mês"** e reescrever os cards em resultado. Exemplo: "Responde às 23h de domingo com as fotos do carro do SEU estoque e marca a visita."
3. Tirar o selo falso.
4. Criar uma escada que faça sentido:
   - **Bot Entrada R$697**: até 100 clientes, com CRM incluído.
   - **Crescimento R$1.497**: até 300.
   - **Performance R$1.997**: ilimitado com uso justo.
   - Os custos cabem: hoje 100 conversas custam cerca de R$124.
5. CRM sozinho a **R$397** ou dentro do bot. A R$800 ele perde para tudo.
6. Trocar o teste grátis por **implantação paga de R$497**, com o onboarding no WhatsApp feito por você e garantia: se em 30 dias o bot não agendar nenhuma visita, devolve a implantação.
7. Fazer demo ao vivo de 10 minutos com o estoque do próprio lojista, usando o feed de estoque.
8. Mirar em loja que já investe em anúncio na Meta. Vender anúncio mais bot junto é o seu diferencial natural.

**NÃO FAZER (prioridade 3)**
- Não cortar preço às cegas. A DSC prova que ele se paga.
- Não cobrar por venda atribuída.
- Não oferecer teste grátis com prazo fixo.
- Não fazer white-label nem "inteligência de mercado" sendo fundador solo.
- Não mostrar no painel um "vendas geradas" que vai aparecer zerado.
- Não mexer na tabela de novo antes de 10 demos com o caso da DSC na mão.

### A primeira coisa a fazer

Tirar do banco os números dos últimos 90 dias da DSC: clientes atendidos, quantos fora do horário, tempo de resposta, fotos enviadas, visitas agendadas e o caso do Sandero. Com isso, levar uma página para o dono da DSC e perguntar duas coisas: **"isso bate com o que você vê?"** e **"você pagaria isso se não fosse cliente da agência?"**

A resposta mostra se o problema é preço ou venda a frio, e a mesma página vira o material de venda e o rascunho do card do Dashboard.
