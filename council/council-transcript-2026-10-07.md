# Conselho — CRM multi-nicho? (2026-10-07)

## Pergunta original

> pense sobre a ideia de transformar esse crm+bot em um crm para varios nichos e não so de concessionaria

## Pergunta enquadrada (enviada aos 5 conselheiros)

DECISÃO: Transformar um CRM + bot de WhatsApp que hoje é feito para concessionárias/lojas de veículos em um CRM multi-nicho (servir vários segmentos, não só concessionária)?

QUEM É: João, fundador solo da Amply (agência/tecnologia, Brasil), que construiu sozinho o produto com ajuda de IA. Também gerencia anúncios Meta para os clientes.

O PRODUTO HOJE (Supabase + React + edge functions, ~100 migrations):
- CRM com estoque de veículos, leads, funil, lista de espera, custos do veículo, vendidos, financeiro, contratos.
- Bot de IA no WhatsApp (API oficial da Meta, coexistência), Instagram Direct em produção, Messenger construído. App Review da Meta aprovado em 05/10/2026.
- Bot consulta estoque em tempo real, manda vitrine/catálogo, agenda visita, transcreve áudio, lê story, passa para humano.
- Consulta de placa (FIPE), feed público de estoque, disparos/campanhas, aniversário, reengajamento, atribuição ctwa_clid → CAPI, push, cobrança Asaas, planos por volume (CRM R$800; bot R$1.497–2.497/mês), 2FA, admin multi-tenant.
- Acoplamento a veículo: ~35 de ~50 arquivos citam carro/veículo/placa/FIPE; o prompt do bot tem ~190 menções a carro/moto/placa/test-drive; tabela central `cars`.

TRAÇÃO: 2 clientes pagantes, ambos "isento/personalizado". DSC Seminovos (bot; ~218 conversas/mês a ~R$1,24; 1ª venda atribuída em 27/08/2026; ~R$2.000/mês) e Leandrinho Motos (só CRM + disparos). Nenhuma venda pela tabela pública.

OPERAÇÃO: fundador faz tudo — código, deploy, suporte, onboarding Meta, diagnóstico de bot mudo. Incidentes recentes. Pendências: estoque com quantidade, nota fiscal, financiamento, portais.

O QUE ESTÁ EM JOGO: tempo e foco de um fundador solo; mercado maior vs. diluir o diferencial vertical e virar mais um CRM genérico de WhatsApp (Kommo, RD, Zenvia, Blip, ChatGuru, Poli…).

---

## Respostas dos conselheiros

### O Contrarian

A falha fatal é esta: você quer multiplicar o mercado sem ter provado que vende para o mercado que já tem. São 2 clientes, os dois com preço "isento/personalizado" e nenhuma venda pela tabela pública. Ainda não existe um produto validado para generalizar. O que existe é uma hipótese que funcionou duas vezes com preço camarada. Ir para multi-nicho agora é fugir da pergunta que dói: "um lojista que eu não conheço paga R$1.497 pela tabela?" Se a resposta for não, cinco nichos vão dar cinco "nãos".

Segundo problema: o gargalo não é mercado, é você. Onboarding da Meta cheio de armadilhas, bot que fica mudo sem erro e incidentes de produção recentes. Tudo isso cai numa pessoa só. Cada nicho novo traz clientes com outro vocabulário, outro funil e outras expectativas de suporte. Com dez clínicas e dez imobiliárias você não escala, você afoga. E o custo de suporte de um CRM genérico é maior que o de um vertical, porque o cliente genérico não sabe o que quer.

Terceiro problema: a refatoração. São 35 de 50 arquivos, 190 menções no prompt e a tabela `cars` no centro. Tirar isso significa meses mexendo na fundação de um sistema que já cai sozinho e que tem migrations fora de sincronia com o banco. Você vai quebrar a DSC, que é o único caso de sucesso real, para atender clientes que ainda nem existem.

Quarto problema: lá fora você vira commodity. Contra Kommo, Blip e ChatGuru você não tem marca, equipe, preço nem tempo de mercado. Sua única vantagem é o bot entender carro: FIPE, lista de espera, estoque ao vivo e venda atribuída. Generalizar é jogar fora o único fosso que você tem.

As perguntas que você está evitando:
- Quantas lojas de veículos você abordou pela tabela e quantas recusaram, e por quê?
- Algum cliente de outro nicho pediu isso, com dinheiro na mão, ou é especulação?

Se não tem um cliente pagante de fora esperando, a resposta é não. Venda 10 lojas de carro primeiro.

### O Pensador de Primeiros Princípios

**A pergunta está errada.** "Multi-nicho ou não" é uma pergunta de arquitetura. O problema real é outro: ninguém pagou pela tabela ainda. Você tem 2 clientes, ambos com preço negociado na mão, e nenhuma venda a frio. Ainda não se sabe se *alguém* compra esse produto a R$1.497. Multiplicar o mercado endereçável por 10 não serve de nada quando a taxa de conversão medida é zero.

Comece pelo que você realmente vende. Não é CRM, que é commodity e onde Kommo e RD já ganharam. O ativo é um **bot que vende consultando estoque em tempo real**, com atribuição de anúncio fechando o ciclo até a venda. A primeira venda atribuída em 27/08 é o único dado de valor que você tem. Separando assim, o "acoplamento a veículo" se divide em duas coisas:

- **Infraestrutura genérica**: canal Meta aprovado, coexistência, disparos, CAPI, cobrança, multi-tenant. Isso já é agnóstico de nicho e foi a parte cara.
- **Conhecimento do domínio**: FIPE, placa, lista de espera, test-drive. É o que o cliente percebe como "entende meu negócio".

Multi-nicho joga fora o segundo e vende o primeiro, justamente a parte que os concorrentes também têm.

Tem ainda uma restrição que ninguém citou: **você é o gargalo de onboarding**. Cada WABA nova custa horas suas com armadilhas da Meta. Mais nichos trazem mais tipos de cliente, mais prompts, mais formas de o bot "ficar mudo" e o mesmo único João. Para um fundador solo, o mercado endereçável real é limitado pelas horas de suporte, não pelo número de segmentos.

As perguntas certas são duas. Primeira: consigo vender **5 lojas de veículos pela tabela** em 60 dias, usando o fato de você mesmo gerenciar os anúncios como canal de entrada? Segunda: o onboarding pode deixar de depender de mim?

Se a primeira falhar com o nicho que você domina, trocar de nicho não conserta, porque o problema é a oferta ou o canal. Se der certo, o próximo nicho óbvio é o "vizinho de estoque" (motos 0km, náutica, máquinas), não clínica.

### O Expansionista

**O ativo que vale mais não é o CRM de carro. É o encanamento da Meta.**

Você tem App Review aprovado (Instagram Advanced + WhatsApp), coexistência funcionando e o caminho anúncio → conversa → venda fechado com `ctwa_clid` → CAPI. Tem também a primeira venda atribuída ao bot. Kommo, RD, Blip e ChatGuru vendem caixa de entrada. Nenhum deles prova ao dono da loja que *aquele real de anúncio virou aquela venda*. E você ainda gerencia os anúncios. Isso já é um produto completo de "tráfego que se paga". O nicho é só o recheio.

**O upside está escondido em três lugares:**

1. **Verticais com "estoque", não qualquer nicho.** Não vá para academia nem para estética. Vá para quem tem a mesma forma de negócio: imobiliária, náutica, máquina agrícola, moto 0km, caminhão. Estoque, lista de espera, feed público, vitrine no WhatsApp, visita agendada e portais formam a mesma arquitetura. A tabela `cars` vira `itens` com atributos por vertical, e o prompt vira um pacote de vertical. Imobiliária é o próximo passo natural: ticket maior, dor de lead idêntica, portais equivalentes (ZAP/VivaReal) e financiamento junto.

2. **A agência como canal de distribuição.** Cada cliente de anúncio da Amply é um cliente do bot com custo de aquisição zero. Melhor ainda: outras agências de tráfego no Brasil sofrem para provar ROI ao cliente. Um white-label "bot + atribuição" para agências multiplica o alcance sem você fazer onboarding de cada loja.

3. **O dado de atribuição como fosso.** Com N lojas mandando eventos de venda pela CAPI, você passa a saber qual criativo vende carro, imóvel ou moto. Esse conhecimento entre clientes otimiza a campanha de todos e nenhum CRM genérico tem.

**O erro seria pensar pequeno:** ou "concessionária para sempre" ou "CRM genérico". O movimento grande é virar **plataforma vertical de venda de bens de alto valor pelo WhatsApp, com atribuição de anúncio embutida**. Você vende pela agência e abre um vertical por vez, cada um com o mesmo motor e um pacote próprio.

### O Outsider

Olhando de fora, sem saber nada do seu setor: você não tem um produto de concessionária pronto para generalizar. Tem dois clientes que não pagam a tabela, uma venda atribuída ao bot e um fundador que ainda é a pessoa que conserta tudo. A pergunta "multi-nicho?" parte de uma premissa que eu, como estranho, não vejo provada: a de que o nicho atual já foi vencido.

O que um comprador de fora enxerga:

1. **Ninguém comprou pelo preço da tabela.** R$1.497 a R$2.497 por mês é só um número no site. Você não sabe se um lojista desconhecido paga isso. Antes de procurar dono de clínica, descubra se o terceiro lojista de carro paga.

2. **O seu diferencial só faz sentido para quem é do ramo.** "Lista de espera que avisa quando entra o carro", FIPE e estoque em tempo real no bot: para quem vende carro, isso é ouro. Para uma clínica de estética, isso nem existe. Ao generalizar, você tira exatamente o que te separa do Kommo e fica com o que todo mundo já tem: WhatsApp, funil e disparo. Para uma academia, você vira "mais um", e mais caro.

3. **A sua dor de verdade é invisível para você.** Token, WABA, coexistência, bot que fica mudo: isso é operação, não produto. Cada novo nicho multiplica esse suporte, e quem faz o suporte é você. Mais mercado com o mesmo João significa mais incidentes, não mais receita.

4. **"Vários segmentos" não é uma frase que alguém compra.** Ninguém acorda querendo um "CRM multi-nicho". O lojista quer "vender mais carro pelo WhatsApp", e isso você já entrega e já prova com o caso do Celta que virou Sandero.

Minha leitura: o próximo passo não é mudar a tabela `cars`, é **vender 5 contas pela tabela pública** para lojas de veículos. Se você não conseguir, o problema é venda ou preço, e mudar de nicho não resolve isso. Se conseguir, aí você terá dados para escolher um segundo vertical específico, um só e com estoque (motos 0km, náutica, máquinas agrícolas), em vez de "todo mundo".

### O Executor

**Não reescreva nada. Segunda-feira você não mexe numa linha do código.**

A pergunta "multi-nicho, sim ou não?" é grande demais pra ter primeiro passo. Os números dizem o seguinte: 2 clientes, os dois com preço personalizado, nenhuma venda pela tabela pública. Ainda não está provado que alguém de fora paga R$1.497 por esse produto, nem no nicho de veículos. Generalizar 35 arquivos, a tabela `cars` e um prompt com 190 menções a carro leva de 2 a 3 meses de refatoração sem cliente esperando do outro lado. E você é o único que faz deploy, suporte e diagnóstico quando o bot fica mudo. Nesse período a DSC vai ter incidente e você não vai estar olhando.

O que dá pra fazer essa semana:

1. **Segunda:** Leandrinho Motos sai do "isento" e passa a pagar o plano de bot pela tabela. Se ele recusar, a resposta mais importante do mês é essa, mais que qualquer análise de mercado.
2. **Terça e quarta:** você já gerencia anúncio Meta. Monte uma campanha de R$300 pra lojas de seminovos de uma região e use a primeira venda da DSC como argumento. A meta é 3 demos agendadas.
3. **Quinta:** se algum cliente seu da agência for de outro nicho (clínica, imobiliária), ofereça o bot de graça por 30 dias com o prompt reescrito à mão, sem tocar no schema. A coluna do estoque passa a guardar "procedimento" ou "imóvel". É gambiarra, e a ideia é essa: medir demanda gastando dois dias, não dois meses.
4. **Sexta:** confira o resultado. Se surgiram 3 demos de loja de veículo e nenhum interesse do outro nicho, o assunto está decidido. Se o outro nicho converteu, aí sim vale abstrair, e só a parte que esse cliente realmente usou.

Multi-nicho é decisão pra quando você tiver 10 clientes pagando pela tabela. Agora o gargalo é vender, não o tamanho do mercado.

---

## Revisão cruzada

**Mapeamento do anonimato:** A = Expansionista · B = Executor · C = Contrarian · D = Outsider · E = Primeiros Princípios

Cada revisor recebeu as mesmas 5 respostas anônimas; quatro deles receberam um ângulo extra para olhar (economia/concorrência, risco técnico/plataforma, modelo de negócio, churn/dados).

### Revisor 1
**1. Mais forte: E.** É a única que separa o que dá para reaproveitar em qualquer nicho (canal Meta aprovado, coexistência, CAPI, cobrança, multi-tenant) do que o cliente sente como "entende meu negócio" (FIPE, placa, lista de espera). Com essa separação, "multi-nicho" deixa de ser uma decisão de arquitetura e vira uma decisão de produto. Ela também aponta o fundador como gargalo do onboarding. A B é a mais prática, mas erra num ponto: manda o Leandrinho pagar o plano de bot, e ele só usa CRM e disparos.

**2. Maior ponto cego: A.** Fala em plataforma, white-label para outras agências e fosso de dados com dois clientes isentos, nenhuma venda pela tabela e um fundador que já não dá conta do suporte. Não fala de operação nem de incidentes. Também ignora que cada agência parceira multiplica o onboarding na Meta, justamente onde mais aparecem armadilhas.

**3. O que todas deixaram passar:**
- **O teste do vizinho já está em casa.** O Leandrinho é de motos, e a análise de estoque com quantidade já mostrou que o schema nem cobre motos: falta separar a venda do veículo. Antes de pensar em imobiliária, esse cliente mostra quanto custa sair de carro usado.
- **Talvez o negócio seja a agência.** Ninguém perguntou se o bot funciona melhor como produto avulso ou como algo que segura e encarece o contrato de anúncios da Amply. A resposta muda preço, canal e prioridade.
- **Risco de concentração.** A DSC é praticamente toda a receita e todo o caso de sucesso. Perder a DSC pesa mais do que qualquer nicho novo.

### Revisor 2 (ângulo: economia unitária, concorrência, o que o fundador quer)
**1. A mais forte é a E.** Ela separa o que é genérico (canal Meta, CAPI, cobrança, multi-tenant) do que é conhecimento de veículo (FIPE, placa, lista de espera) e mostra que ir para vários nichos joga fora a parte que o concorrente não tem. Também é a única que trata o onboarding dependente do João como o teto do negócio. A B é a mais prática e complementa a E.

**2. O maior ponto cego é o da A.** Ela propõe plataforma, outros nichos e white-label para agências, mas nunca houve uma venda pela tabela e o fundador está sozinho e afogado em incidentes. Vender para outras agências multiplica justamente o suporte da Meta, que já é o gargalo. E o "fosso de dados" com 2 clientes não existe.

**3. O que todas deixaram passar:**
- **Custo real por cliente.** R$1,24 por conversa é irrelevante perto das horas do João em onboarding, incidentes e bot mudo. Ninguém calculou a margem por hora.
- **Que negócio ele quer ter.** Pode ser que o produto certo seja a agência, com o bot embutido na gestão de anúncios para segurar o cliente, e não um SaaS. Isso muda preço, nicho e escala.
- **Concentração.** Quase toda a receita vem da DSC. Se ela sair, o negócio acaba.
- **A própria Meta como concorrente.** Ela está lançando IA nativa para empresas no WhatsApp, o que pode tornar commodity o bot genérico, mas não o bot que conhece veículo e fecha a atribuição.

### Revisor 3 (ângulo: risco técnico/plataforma, tamanho de mercado)
**1. A mais forte é a E.** É a única que separa o que serve para qualquer nicho (canal Meta, CAPI, cobrança, multi-tenant) do que só serve para veículos (FIPE, placa, lista de espera). Mostra que o multi-nicho joga fora justamente a parte que diferencia o produto. E troca a pergunta errada por duas mensuráveis: vender 5 lojas pela tabela em 60 dias e fazer o onboarding deixar de depender do João. A B é a mais prática, mas não explica o porquê.

**2. O maior ponto cego é da A.** Ela propõe white-label para outras agências e fosso de dados entre clientes sem enfrentar três fatos: venda pela tabela = zero, o João é o gargalo do onboarding e o suporte já tem incidentes. Cada agência parceira multiplica WABA, token e bot mudo. Além disso, atribuição com 1 venda não é fosso nenhum.

**3. O que todas as cinco deixaram passar:**
- **Risco de plataforma:** desde jan/2026 a Meta proíbe chatbot de IA de uso geral na API do WhatsApp. Bot de nicho é mais defensável que "assistente para qualquer negócio". *(Nota do relator: conferir os termos atuais da política antes de agir com base nisso.)*
- **Margem:** os R$1,24 por conversa incluem a tarifa da Meta e o custo do modelo de IA? Nenhuma conselheira calculou a margem por cliente.
- **Dependência da agência:** os 2 clientes vêm da Amply. Se o cliente sai da agência, provavelmente sai do bot também, e o produto nunca foi testado sozinho.
- **Tamanho do mercado:** o Brasil tem dezenas de milhares de revendas. O teto está longe, então expandir de nicho não se justifica por falta de mercado.

### Revisor 4 (ângulo: modelo de negócio — agência vs SaaS)
**1. A mais forte é a E.** É a única que separa o que custou caro e já serve pra qualquer nicho (canal Meta, CAPI, cobrança, multi-tenant) do que o cliente enxerga como diferencial (FIPE, placa, lista de espera). Também é a única que pergunta se o onboarding consegue deixar de depender do João. A B é a melhor em ação concreta: cobrar a tabela do Leandrinho é o teste mais barato que existe.

**2. O maior ponto cego é o da A.** Ela propõe plataforma e white-label pra outras agências sem levar em conta que ninguém pagou a tabela e que o gargalo é o próprio João. White-label multiplica suporte e onboarding Meta, justamente o que já está derrubando ele.

**3. O que todas deixaram passar: isso é SaaS ou é agência?** A DSC paga R$2.000 pelo software ou pelo João (anúncio, ajuste do bot, suporte)? Os dois clientes vieram da agência, e a tabela pública nunca vendeu sozinha. Talvez o produto real seja serviço: anúncio + bot + atribuição, vendido como pacote da Amply, com preço por resultado (por lead qualificado ou por venda atribuída). A atribuição via ctwa_clid prova isso, e nenhum concorrente de caixa de entrada consegue cobrar assim.

Ninguém citou dois riscos:
- **Concentração:** a DSC é quase toda a receita.
- **A própria Meta:** os agentes de IA dela no WhatsApp ameaçam o bot genérico, não o bot que entende de carro.

### Revisor 5 (ângulo: churn/concentração, dados que já existem)
**1. A mais forte é a E.** Ela separa o que o produto tem de genérico (canal Meta aprovado, coexistência, CAPI, cobrança) do que é específico de veículo (FIPE, placa, lista de espera). Com isso mostra que ir pra multi-nicho joga fora justamente a parte que os concorrentes não têm. Também é a única que cobra um onboarding que não dependa do João. A B ganha na execução concreta, mas não explica o porquê.

**2. O maior ponto cego é da A.** Ela propõe virar plataforma e fazer white-label para outras agências sem levar em conta que ninguém comprou pela tabela e que o fundador já não dá conta do suporte. Ainda trata uma venda atribuída como se fosse um fosso de dados. Uma venda é um caso isolado, não estatística.

**3. O que todas deixaram passar:**
- **Concentração:** a DSC é praticamente toda a receita e o único caso real. Se ela sair, sai junto o produto, o case e a prova de atribuição. Ninguém propôs blindar a DSC antes de tudo, com contrato, retorno documentado e menos incidentes.
- **Os dados já existem:** dá pra cruzar R$2.000 por mês contra as vendas atribuídas nas 218 conversas mensais. Isso diz se a DSC renova antes de qualquer abordagem a frio. Lembrando que a atribuição por telefone falha quando quem compra é outra pessoa da casa.
- **Leandrinho:** ele é moto, um vertical vizinho, e não adotou o bot. Isso já responde em parte se um vertical vizinho compra.
- **Amarração com a agência:** o CRM pode estar sendo mantido por causa dos anúncios. Se o cliente largar os anúncios, o CRM sai junto.

---

## Veredito do presidente

### Onde o conselho concorda

Os cinco conselheiros chegaram à mesma conclusão: não é hora de virar multi-nicho. A base é a mesma para todos. Ninguém comprou pela tabela pública, os dois clientes são isentos ou têm preço personalizado, e o gargalo é o próprio João. Ele faz o onboarding na Meta, atende o suporte e resolve os incidentes. Refatorar `cars` e uns 35 arquivos, com migrations fora de sincronia, coloca em risco a DSC, que é o único caso de sucesso, e isso para atender uma demanda que ninguém demonstrou.

O conselho também concorda sobre o valor do produto. O que tem valor está no domínio: o bot consulta o estoque de veículos em tempo real, usa FIPE e placa, gerencia a lista de espera e fecha a atribuição do anúncio até a venda. Uma caixa de entrada genérica concorre de igual para igual com Kommo, Blip e ChatGuru, e chega mais cara. Mesmo quem defende expandir aceita que a expansão seria para verticais que também têm estoque, um de cada vez, e não para qualquer tipo de negócio.

### Onde o conselho diverge

A divergência real é sobre o que acontece depois.

- **O Expansionista** enxerga uma plataforma de venda de bens caros pelo WhatsApp, com imobiliária logo em seguida, white-label para outras agências e um "fosso de dados". A revisão cruzada considerou isso, por unanimidade, o maior ponto cego. Não há fosso de dados com uma única venda atribuída, e cada agência parceira multiplica justamente o onboarding na Meta, que é o gargalo.
- **O Executor** quer agir já, com prompt reescrito à mão para outro nicho, como teste barato.
- **O Contrarian e o Outsider** querem antes provar o vertical de carros, com 5 a 10 lojas.

O Pensador de Primeiros Princípios resolve o conflito. A pergunta certa não é sobre arquitetura do sistema. É saber se o produto vende para quem não conhece o João.

### Pontos cegos que a revisão pegou

1. **SaaS ou agência?** Os dois clientes vieram da Amply. A DSC pode estar pagando R$2.000 pelo João (anúncios, ajustes do bot, suporte) e não pelo software. Nesse caso o produto de verdade é o pacote "anúncio + bot + atribuição", que talvez possa ser cobrado por venda atribuída. Nenhum concorrente de caixa de entrada consegue oferecer esse tipo de cobrança.
2. **Concentração.** A DSC é quase toda a receita, o único case e a única prova de atribuição. Ninguém propôs protegê-la.
3. **O teste do nicho vizinho já foi feito.** O Leandrinho é loja de motos e não adotou o bot. Além disso, o schema nem comporta moto 0km sem antes separar a venda do veículo. Sair do carro usado já tem custo medido.
4. **Margem por hora.** O custo de R$1,24 por conversa é irrelevante perto das horas do João gastas em onboarding e incidentes.
5. **Risco de plataforma.** A Meta restringe chatbots de IA de uso geral na API do WhatsApp Business. Isso ameaça o bot genérico, não o bot especializado. Os termos atuais precisam ser conferidos antes de tomar qualquer decisão com base nisso.
6. **Mercado não é problema.** Há dezenas de milhares de revendas no Brasil. Falta de mercado não justifica expandir.
7. **Correção ao Executor.** O teste certo para o Leandrinho é sair do isento e pagar o plano CRM de R$800. O plano com bot não serve, porque ele não usa o bot.

### A recomendação

**Não. Nada de multi-nicho agora, e nenhuma linha de refatoração para isso.** O João deve tratar o produto como vertical de veículos, vendido junto com a gestão de anúncios da Amply, e trocar a pergunta "quantos nichos?" por "isto vende sem desconto?".

O critério objetivo para reabrir a decisão tem três condições, todas obrigatórias:

- **10 lojas pagando o preço de tabela por 3 meses seguidos.** Pelo menos 3 delas precisam ter chegado sem relação prévia com a Amply.
- **Onboarding feito sem o João colocar a mão,** em menos de 2 horas por cliente.
- **Um cliente de um vertical vizinho com estoque** (moto 0km, náutica, máquinas, caminhão) pedindo o produto e disposto a pagar.

Atendidas as três, ele entra em um único vertical, e só então faz a refatoração que já está mapeada: separar a venda do veículo na tabela `sales` e trocar `cars` por itens com atributos por vertical.

Se as lojas novas só fecharem quando levam os anúncios junto, essa é a resposta à pergunta 1. Nesse caso o negócio é um serviço com software próprio, e o preço deve ser reestruturado nessa direção. Multi-nicho deixa de ser assunto.

### A primeira coisa a fazer

Esta semana, o João deve cruzar as conversas da DSC desde agosto com as vendas que a loja fechou, resolvendo na mão os casos em que comprou outra pessoa da casa. O resultado é uma página com "R$ X pagos, Y vendas atribuídas ao bot, R$ Z de margem para a loja". Essa página serve para três coisas:

- É a base da conversa de renovação com a DSC, o que protege a principal receita.
- É o material de venda para as próximas lojas.
- Responde se o cliente paga pelo software ou pelo João.
