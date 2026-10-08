# Conselho — "Como diminuo meu custo para aumentar meu lucro?" (2026-10-07)

## Pergunta original

> sabem como eu diminio meu custo para aumentar meu lucro?

## Pergunta enquadrada

PERGUNTA: "Como eu diminuo meu custo para aumentar meu lucro?"

CONTEXTO: João, fundador solo da Amply (Brasil), CRM + bot de IA no WhatsApp/Instagram para lojas de veículos; também é agência de anúncios Meta. 2 clientes (DSC ~R$2.000/mês com bot, ~218 conversas/mês; Leandrinho Motos só CRM, "isento"). Ninguém comprou pela tabela.

CUSTOS CONHECIDOS:
- IA do bot: ~US$0,23 ≈ R$1,24 por conversa (DSC: 218 conversas = US$50,12/mês); modelo da medição incerto.
- Código do bot (verificado em `process-conversation/index.ts`): padrão `claude-sonnet-4-6` com `cache_control`; `llm_provider` por tenant troca para `gpt-5-mini` (DSC em 'openai' desde ago/2026); até 10 iterações de ferramenta por turno; janela de 20 mensagens; prompt de sistema longo; imagens recentes; `whisper-1` para áudio; saída até 4.096 tokens no gpt-5.
- Fixos: Supabase Pro US$25, Placa Fipe, Resend, Vercel, domínio.
- Asaas (cartão), Simples (regime não confirmado).
- Templates: Meta cobra no cartão da loja.
- Maior custo não medido: horas do João.

DECIDIDO HOJE: hora do João é o custo decisivo; implantação R$1.500 com fidelidade; excedente R$3/conversa; fim da isenção do Leandrinho; confiabilidade e card "o que o robô fez"; parar polimento.

> Nota: o enquadramento dizia que o card de resultados estava "sem commit". Durante a sessão, dois commits entraram (`4ebc37f` painel de resultados; `faf7f85` tela de vendas atribuídas) — um revisor pegou a premissa desatualizada; confirmado com `git log`.

---

## Respostas dos conselheiros

### O Contrarian

A falha fatal está na própria pergunta. Com R$2.000 de receita e talvez R$600–800 de custo em dinheiro (IA R$270, Supabase R$135, placa, Resend, Vercel, Asaas, imposto), zerar **tudo** sobe o lucro uns R$700/mês. Esse é o teto do corte. Um único cliente novo na tabela vale 2 a 3 vezes isso. Cortar custo aqui é otimizar o arredondamento.

O que vai dar errado se ele for cortar mesmo assim:

1. **O R$1,24 por conversa é medido no modelo errado.** A DSC está no gpt-5-mini "em teste" desde agosto. É provável que o US$50 seja do mini. Se o padrão (Sonnet 4.6, até 10 iterações com ferramentas, imagens no contexto) custar 3 a 5 vezes mais, o excedente de R$3/conversa decidido hoje fica no prejuízo justamente no cliente que mais conversa. Antes de mexer em preço ou modelo, ele precisa medir os dois provedores no mesmo mês, por conversa.

2. **Cortar na IA é atirar no produto.** Modelo menor, prompt mais curto ou menos iterações economizam uns R$100/mês. Se a DSC perceber o bot pior e cancelar, são -R$2.000/mês, o que apaga uns 20 meses dessa economia num mês só. Com um cliente pagante, 100% da receita está em risco a cada "otimização".

3. **Automatizar para economizar horas custa horas agora.** Fazer o onboarding self-service para poupar 10h por cliente, com zero clientes novos na fila, tem retorno negativo. Primeiro vende, depois automatiza o que se repetiu.

4. **O único corte real que ninguém olhou é o imposto.** Software no Simples cai no Anexo V (~15,5%) se o fator R ficar abaixo de 28%. Fundador solo sem pró-labore está lá. Com pró-labore de ~28% do faturamento, ele vai para o Anexo III (~6%). No faturamento atual, depois do INSS do pró-labore, sobra algo como R$100–150/mês. É pouco, mas é o maior corte sem risco que existe, e escala com a receita. Confirmar com o contador esta semana.

Conclusão: corte o imposto, meça a IA direito e não toque na qualidade do bot. O lucro vem do segundo cliente pagante, não da planilha de custos.

### O Pensador de Primeiros Princípios

A pergunta está errada. Com um único cliente pagante, cortar custo é o caminho de menor teto possível.

Faça a conta inteira. A receita é R$2.000. Saem uns R$270 de IA (US$50), de R$300 a R$500 de fixos, uns R$150 a R$300 de imposto e uns R$60 de cartão. Se você zerar TODO custo que sai do cartão, o lucro sobe no máximo uns R$1.000 por mês. Esse é o teto. Já um segundo cliente na tabela (R$1.497) traz cerca de R$1.100 de margem, e o custo marginal dele é só a IA (~R$270) mais o imposto. Um cliente novo vale mais que cortar todos os custos juntos, e não tem teto.

O problema real não é custo, é denominador. Hoje o fixo pesa uns 20 a 25% da receita porque cai em cima de um pagante só. Com 8 clientes, vira 3%. O mesmo real "economizado" aparece sozinho quando você divide por mais lojas.

Então o que significa "custo" aqui? Não é a conta da OpenAI, é **o que impede o cliente seguinte de existir**. As 8 a 15h de onboarding, os incidentes e o deploy frágil não são despesa, são gargalo de capacidade. Se cada cliente custa 15h para entrar e mais umas 5h por mês de suporte, você trava em uns 6 a 8 clientes antes de acabar a semana. Corte nisso, medido em **horas por cliente-mês**, e não em reais por conversa.

O que eu derrubaria:
1. **"Lucro" num negócio solo é R$ por hora do João**, não receita menos despesa. Comece a anotar as horas por cliente hoje. Sem isso, toda decisão de custo é chute.
2. **Trocar o modelo da DSC para economizar não faz sentido.** Você economiza uns R$150 e arrisca o único contrato de R$2.000. Assimetria de 13 para 1.
3. **"Ninguém comprou pela tabela" é o dado mais caro da lista.** Se o preço não fecha, cortar custo só deixa mais barato um produto que ninguém está comprando.

A pergunta certa é esta: quanto tempo leva para fechar e implantar o cliente nº 3, e o que derruba esse número pela metade?

### O Expansionista

Cortar custo com 2 clientes é otimizar o denominador errado. O custo de João cai mais rápido quando ele divide por mais clientes e quando alguém de fora paga pelas horas dele.

1. **O App Review aprovado em 05/10 é o maior corte de custo que existe, e ninguém está tratando assim.** O Instagram em Advanced Access permite que qualquer conta profissional se conecte sozinha. Isso pede um plano "Instagram primeiro": a loja se conecta em 10 minutos, sem as 8–15h do WhatsApp oficial. O WhatsApp entra depois, como upgrade pago. O onboarding sai de ~12h para menos de 1h por cliente.

2. **Os fixos dissolvem com escala.** Hoje são ~R$500/mês divididos por 2 clientes, cerca de R$250 cada. Com 20 lojas, viram ~R$25 cada. O custo de IA por conversa (R$1,24) contra o excedente de R$3 já dá margem de 140%. Escalar baixa o custo unitário de tudo.

3. **Vender pelas mãos de outras agências.** A Amply já é agência Meta e conhece o ramo. Agências que atendem concessionária podem revender o bot: elas fazem o onboarding e o suporte de primeiro nível, e João recebe uma licença de R$600–900 por loja sem gastar hora nenhuma. É o único jeito de crescer em que a hora dele não cresce junto.

4. **Juntar anúncio e bot, e cobrar pela venda.** A captura do `ctwa_clid` e a tela de vendas atribuídas já existem. Um carro dá à loja R$3–5 mil de margem, então uma taxa de R$150–300 por venda atribuída paga o ano inteiro de IA de um cliente em 1 ou 2 vendas. O anúncio que a Amply gerencia gera o lead, o bot fecha, e um contrato só cobre os dois.

5. **A primeira venda (Celta → Sandero) é material de vendas que não custou nada.** Transformar esse caso e o Leandrinho em depoimento barateia a aquisição dos próximos 10 clientes.

O custo que mais pesa hoje é estar vendendo pouco.

### O Outsider

Visto de fora, a conta é esta: receita de R$2.000 por mês e custo em dinheiro perto de R$700 (IA ~R$270, infraestrutura ~R$350, cartão, imposto). Isso dá cerca de 65% de margem. Um contador olharia e diria: "você não tem problema de custo, tem problema de escala". Cortar 30% da IA daria uns R$80 por mês, o preço de um almoço. Mesmo assim, há três cortes reais que quem é do ramo não vê:

1. **Imposto, que é o maior custo em dinheiro e ninguém mediu.** Software no Simples cai no Anexo V (15,5%), a menos que a folha (pró-labore) passe de 28% do faturamento. Com isso, o fator R leva para o Anexo III (6%). Sobre R$2.000, a diferença é de ~R$190 por mês, mais que a conta inteira de IA. Leve isso a um contador esta semana. Uma hora de consulta se paga no primeiro mês.

2. **Taxa de cartão.** Com cartão a ~4%, a DSC custa ~R$80 por mês. Com PIX recorrente ou boleto, sai por ~R$2. Ofereça 5% de desconto no PIX e você ainda sai ganhando.

3. **Funcionalidade nova também é custo.** Os dois últimos commits criaram telas novas (painel de resultados, vendas atribuídas) para 1 cliente pagante. Cada tela é mais uma coisa para quebrar, dar suporte e migrar schema. Daqui até o terceiro cliente pagante, a regra é: nada novo que um cliente não tenha pedido por escrito.

O que mais chama a atenção de quem vê de fora: você também é agência de anúncios Meta. A DSC paga gestão de tráfego separada ou isso está embutido nos R$2.000? Se estiver embutido, seu maior custo escondido é trabalho de agência dado de graça. E isso se cobra à parte (R$800 a R$1.500 é o mercado), não se corta.

Por último, não otimize o modelo de IA antes de saber em qual modelo os US$0,23 foram medidos. Hoje você está trocando de fornecedor no escuro.

### O Executor

Ordem de segunda de manhã, da tarefa que mais rende por minuto até a que menos rende:

**1. Ligar pro contador (20 min).** Confirmar se você paga no Anexo III (~6%) ou no V (~15,5%). Se estiver no V, dá pra ir pro III pelo fator R, com pró-labore de pelo menos 28% do faturamento. Em R$2.000 a diferença é ~R$190/mês. Na margem de hoje é o maior ganho por minuto que existe.

**2. Trocar cartão por PIX automático ou boleto no Asaas (15 min).** No cartão você paga ~3–5%, no PIX ~R$1–2 fixo. Economiza ~R$60/mês por cliente, e o ganho cresce junto com a base.

**3. Abrir o painel de cobrança da OpenAI e da Anthropic (30 min).** Pegar o gasto de setembro e dividir pelas conversas. Isso responde de vez em qual modelo saíram os US$50. Se foi Sonnet, a DSC no gpt-5-mini já deve estar custando ~70% menos, e aí isso só precisa ser confirmado e anotado.

**4. Três travas no bot (1h, uma linha cada).** Ferramentas de 10 para 4 iterações, saída de 4.096 para 1.500 tokens, histórico de 20 para 12 mensagens. Corta de 25 a 40% dos tokens. É pouco dinheiro, mas é barato fazer. Depois, olhar 20 conversas pra ver se a qualidade caiu.

**5. Planilha de horas (5 min por dia, 2 semanas).** Quatro colunas: onboarding, suporte, incidente e produto. Sem isso, "a hora do João é o maior custo" fica só na intuição, e você não sabe onde cortar.

**6. Roteiro do onboarding (3h, uma vez só).** Escrever o passo a passo do último WhatsApp oficial que você ligou e gravar a tela. Meta: de 8–15h para 4h por cliente. A R$150/h, isso vale R$600 a R$1.650 de margem em cada cliente novo, mais do que a IA inteira custa num ano.

**Não fazer:** caçar economia em Supabase, Resend, Vercel e domínio. São poucas centenas de reais, e qualquer troca custa mais horas do que poupa.

Somando os itens de 1 a 4: ~R$250 a mais de margem por mês, em uma manhã de trabalho.

---

## Revisão cruzada

**Mapeamento do anonimato:** A = Outsider · B = Executor · C = Expansionista · D = Primeiros Princípios · E = Contrarian

Placar: **mais forte** → E (Contrarian) 4 · D (Primeiros Princípios) 1. **Maior ponto cego** → B (Executor) 3 · A (Outsider) 1 · C (Expansionista) 1.

### Revisor 1
**1. A mais forte é a E.** É a única que encontra um erro capaz de dar prejuízo. O R$1,24 provavelmente foi medido no gpt-5-mini. Se o Sonnet, com 10 iterações e imagens, custar de 3 a 5 vezes mais, o excedente de R$3 aprovado hoje faz perder dinheiro justamente no cliente que mais conversa. A E também calcula o ganho do fator R já descontado o INSS do pró-labore (R$100 a 150). A e B prometem R$190 brutos, um número otimista. E aponta o único corte sem risco sem esquecer a regra de não mexer na qualidade.

**2. O maior ponto cego é da B.** Ela corta ferramentas de 10 para 4, a saída de 4.096 para 1.500 e o histórico de 20 para 12 no único cliente pagante. Conferir 20 conversas não basta para pegar uma regressão. São uns R$100 de economia contra R$2.000 de receita em risco, a mesma relação de 13:1 que a D e a E apontam. Ela também automatiza o onboarding sem nenhum cliente na fila.

**3. Todas deixaram passar:**
- **Taxa da Meta por mensagem de template.** O Leandrinho é "só disparos". Se os disparos saem no cartão da Amply, esse é um custo em dinheiro não medido que cresce com o uso, e somado à isenção pode deixar esse cliente no prejuízo. Vale conferir de quem é a forma de pagamento da WABA dele.
- **Concentração de receita.** 100% da receita vem da DSC. Gastar horas em tour animado em vez de confiabilidade é custo, porque perder a DSC zera a receita. Nenhum conselheiro tratou o risco de cancelamento como custo.

### Revisor 2 (ângulo: travas no bot, Instagram primeiro, fator R)
**1. Mais forte: D.** É a única que põe um teto na conta: zerando todo custo em dinheiro, o lucro sobe no máximo ~R$1.000 por mês. Também é a única que transforma o problema numa métrica, horas do João por cliente. E fecha com a razão 13:1 contra mexer no modelo da DSC. E vem logo atrás, e é melhor no risco de o excedente de R$3 dar prejuízo se o custo de R$1,24 foi medido no gpt-5-mini.

**2. Maior ponto cego: C.** Os leads da DSC chegam por anúncio que abre conversa no WhatsApp (é daí que vem o `ctwa_clid`). O Instagram não tem disparo e a janela de 24h é definitiva. "Instagram primeiro" seria vender a loja sem o canal principal: o onboarding do WhatsApp só fica para depois, não some. Pode servir de plano de entrada, não de substituto.

Em B, cortar as ferramentas de 10 para 4 e o histórico de 20 para 12 quebra fluxos de várias etapas (estoque, foto, agendamento). Isso é pior que economizar ~R$50, e D/E estão certas. Baixar a saída de 4.096 para 1.500 no gpt-5 é perigoso: os tokens de raciocínio contam nesse limite, e a resposta pode vir vazia, o que cala o bot sem erro.

**3. O que todas deixaram passar:** o pró-labore não pode ser menor que um salário mínimo (~R$1.600). Com receita de R$2.000, isso é ~80% da receita, não 28%. O INSS de 11% (~R$176) come quase toda a economia de ~R$190 (15,5% para 6%). O ganho líquido fica perto de zero; o IRPF é zero, por isenção. A conta de E, de R$100–150 por mês, é otimista. O fator R só compensa com receita maior.

### Revisor 3 (ângulo: incidente como custo; agência vs CRM)
**1. A mais forte é a E.** É a única que acha um risco numa decisão que o João já tomou hoje. O R$1,24 provavelmente foi medido no gpt-5-mini. Se for isso, o excedente de R$3 dá prejuízo justamente no cliente que conversa mais. Ela também calcula o imposto já descontando o INSS do pró-labore, sem inflar a conta. A D vem logo atrás: trata custo como gargalo de capacidade e cita incidente e deploy frágil.

**2. O maior ponto cego é da B.** Ela corta ferramentas de 10 para 4, histórico de 20 para 12 e saída de 4.096 para 1.500 para economizar uns R$80. Mas esses cortes são exatamente o tipo de mudança que produz "bot mudo" sem erro, como nos dois defeitos de outubro. O ganho é pequeno e o risco cai sobre o único cliente pagante. A C também tem um furo: cobrar por venda atribuída ignora que a atribuição por telefone falhou na primeira venda (o lead entrou pelo Celta e quem fechou o Sandero foi outra pessoa da casa).

**3. O que todas deixaram passar:**
- **Incidente é custo.** Cada bot calado custa horas de diagnóstico, deploy e conversa com o cliente, além do risco de perder a DSC, que é 100% da receita. Estabilidade é o corte mais certo nas horas do João: alarme, checagem antes de deployar e menos remendos. Os últimos commits foram num tour animado, não em estabilidade.
- **Agência contra CRM, em R$ por hora.** A A só chegou perto ao perguntar se o tráfego está embutido nos R$2.000. Ninguém comparou quanto rende cada hora na agência e quanto rende no CRM. A Amply já vai gerir o anúncio da DSC. Se a agência render mais por hora, o lucro vem de redistribuir as horas, não de cortar custo.

### Revisor 4 (ângulo: precisão factual)
Fiz a revisão sem ferramentas, só com o contexto que já tinha.

**Antes das notas, uma correção nas premissas.** Pelo git, os dois últimos commits *criaram* telas: "tela de vendas atribuidas ao atendimento" (faf7f85) e "painel de resultados do assistente" (4ebc37f). O tour vem antes deles. Então o card provavelmente já está commitado. Além disso, as respostas A e C, do jeito que vieram, não fazem as afirmações citadas no pedido. Ainda assim, a tela de vendas atribuídas não é envio de CAPI. A captura do ctwa_clid continua sem envio.

1. **A mais forte é a E.** Ela desconta o INSS do pró-labore e chega a ~R$100–150 líquidos. A e B anunciam R$190 brutos. A E também pega o risco real: o excedente de R$3 pode ter sido calibrado em cima do gpt-5-mini.

2. **O maior ponto cego é da B.** Baixar a saída de 4.096 para 1.500 no gpt-5 pode zerar a resposta, porque o raciocínio consome esse limite. O bot calaria sem erro. O ganho de "25–40%" não tem base. B também diz cartão R$60, A diz R$80. A C ignora que lojas de veículos vivem no WhatsApp e que o Instagram não tem disparo. Os ~R$1.100 da D e o "13:1" não têm fonte. E não fecha com D: R$700 contra R$1.000.

3. **O que todas deixaram passar:** 100% da receita vem da DSC. Perder esse cliente é o maior custo possível, e nenhuma resposta fala de retenção nem de contrato.

> Verificação do relator: `git log` confirmou `4ebc37f` e `faf7f85` como os dois commits mais recentes — feitos durante esta sessão, depois da checagem anterior.

### Revisor 5 (ângulo: PIX vs cartão; pró-labore zerado)
**1. A mais forte é a E.** É a única que liga o custo a uma decisão já tomada hoje. Se o R$1,24 foi medido no gpt-5-mini, o excedente de R$3 pode dar prejuízo quando a conversa roda no Sonnet com 10 iterações. A E também é a única que desconta o INSS do pró-labore na conta do fator R e chega a ~R$100–150, não aos R$190 brutos de A e B. A D chega perto, com o enquadramento melhor (lucro = R$ por hora), mas não traz nenhuma ação.

**2. O maior ponto cego está na A, e logo atrás na B.** O desconto de 5% no PIX custa R$100 sobre R$2.000, mais que os ~R$80 de taxa do cartão. Ou seja, o corte aumenta o custo. A B troca o cartão recorrente, que cobra sozinho, por PIX automático ou boleto, que dependem da ação do cliente e têm inadimplência maior. Com um único pagante, que é 100% da receita, um mês atrasado apaga um ano da economia de R$60.

**3. O que todas deixaram passar:** o pró-labore está zerado. Sem salário para o João, o "lucro" é fictício: ele está financiando a empresa com as próprias horas. Antes de cortar qualquer custo, ele precisa pôr um salário no DRE (e o fator R exige isso de qualquer forma). Também precisa separar os gastos pessoais misturados no negócio. Só então dá para saber se existe margem. E ninguém falou da concentração: com um cliente só, o risco de perder a DSC pesa mais que qualquer linha de custo.

---

## Veredito do presidente

### Onde o conselho concorda

- **Cortar custo é a alavanca pequena.** O custo mensal em dinheiro fica entre R$700 e R$1.000. A IA custa ~R$270 (218 × R$1,24) e o Supabase ~R$135. Zerar tudo, o que é impossível, ainda renderia menos que a margem de um segundo cliente. O fixo pesa 20–25% da receita com 1 pagante e se dilui com escala.
- **O maior custo é a hora do João**, e ninguém mede: onboarding de 8–15h, suporte e incidentes.
- **Não otimizar o modelo antes de saber em qual deles o R$1,24 foi medido.**
- **Não caçar centavos** em Supabase, Resend ou Vercel.

### Onde o conselho diverge

- **Teto do corte:** o Contrarian fala em R$700, o Primeiros Princípios em R$1.000. A diferença é de escopo, não de conclusão.
- **Imposto:** três conselheiros viram R$100–190/mês no fator R. A revisão derrubou esse número (ver abaixo).
- **Travas no bot:** o Executor quer cortar tokens agora. A maioria acha que isso arrisca o único pagante para economizar R$50–100.
- **"Instagram primeiro":** o Expansionista quer isso como produto principal. A revisão aceita só como plano de entrada.

### Pontos cegos que a revisão pegou

1. **O fator R hoje rende quase zero.** O pró-labore mínimo é ~R$1.600, e o INSS de 11% dá ~R$176. A economia é de 9,5% × R$2.000 = R$190. **Ganho líquido: ~R$14/mês.** O fator R só passa a compensar com receita acima de ~R$1.850 (176 ÷ 0,095). Cada cliente novo de R$2.000 acrescenta ~R$190/mês de economia.
2. **O excedente de R$3 pode dar prejuízo.** Ele se paga até a IA custar 2,4× o valor medido (3 ÷ 1,24). Se o Sonnet custar 3× (R$3,72), cada conversa extra perde R$0,72. Se custar 5× (R$6,20), perde R$3,20.
3. **Saída limitada a 1.500 tokens no gpt-5** pode zerar a resposta, porque o raciocínio consome o limite. O bot ficaria mudo sem erro, o mesmo defeito de outubro.
4. **O desconto de 5% no PIX custa R$100**, mais que a taxa do cartão (~R$60–80).
5. **Concentração:** 100% da receita vem da DSC. Perder esse cliente é o maior custo possível, e cada incidente aumenta esse risco.
6. **Pró-labore zerado:** o "lucro" atual é o tempo do João financiando a empresa.
7. **Disparos do Leandrinho:** se saem no cartão da Amply, são um custo que cresce sem ninguém ver.
8. **Git:** o painel de resultados e a tela de vendas atribuídas já estão commitados. A CAPI ainda não existe, então cobrar por venda atribuída não se sustenta hoje.

> **Nota do relator (conferência pós-síntese):** as contas do item 1 e do item 2 fecham. No item 2 falta descontar os ~13% de imposto e cartão da receita do excedente: R$3 × 0,87 = R$2,61, então o empate é em ~2,1× o custo medido (2,61 ÷ 1,24), não 2,4×. Isso deixa a margem do excedente ainda mais apertada e reforça a medição como primeira ação. O salário mínimo de ~R$1.600 é aproximado; confirmar com o contador.

### A recomendação

**(a) CORTAR AGORA**
- Horas de polimento sem pedido de cliente. Foram 4 commits de tour animado antes das features que vendem. Nada novo entra sem pedido escrito até o 3º cliente.
- Trabalho de agência de graça. Se a gestão de tráfego da DSC está embutida nos R$2.000, cobrar à parte (R$800–1.500) na renovação.

**(b) MEDIR ANTES DE MEXER**
- Gasto de setembro por provedor (OpenAI e Anthropic) ÷ conversas por tenant. Isso confirma ou derruba o excedente de R$3.
- Quatro semanas de horas por categoria: onboarding, suporte, incidente, produto e agência. Calcular o R$/hora da agência e o do CRM.
- O cartão cadastrado na WABA do Leandrinho.
- Contador: regime atual e quando o fator R começa a valer a pena (receita acima de ~R$1.850).

**(c) NÃO FAZER**
- **Travas no bot** (10→4 iterações, saída 4.096→1.500, histórico 20→12): calam ou quebram o bot do único pagante para economizar ~R$50–100.
- **Trocar o modelo da DSC agora:** economiza ~R$150 e arrisca R$2.000.
- **Desconto no PIX:** custa R$100 para evitar R$60–80 de taxa.
- **Fator R hoje:** o INSS come R$176 dos R$190 economizados.
- **Automatizar o onboarding:** não há cliente na fila para colher o retorno.
- **Cobrar por venda atribuída:** a atribuição por telefone falhou na 1ª venda e a CAPI não existe.

**(d) O reenquadramento**
> Seu teto de corte em dinheiro é ~R$700–1.000/mês, e o corte seguro hoje é perto de R$0. Para um fundador solo, lucro é R$ por hora. A hora mais cara é a que você gasta em algo que não traz o cliente nº 2 nem protege o nº 1.

### A primeira coisa a fazer

Abrir hoje os painéis da OpenAI e da Anthropic. Pegar o gasto de setembro e dividir pelas conversas de cada tenant. Se o custo por conversa no Sonnet passar de R$3 (2,4× o medido), o excedente aprovado hoje dá prejuízo e precisa ser revisto antes de entrar em contrato.

> Ajuste do relator: com o desconto de imposto e cartão, o limite prático é ~R$2,60 por conversa (≈2,1× o medido), não R$3.
