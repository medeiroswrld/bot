# Conselho — Expandir para EUA e Europa? (2026-10-07)

## Pergunta original

> o que vcs pensam sobre expandir esse crm para estados unidos e europa? mais facil de vender, maior poder de compra

## Pergunta enquadrada

PERGUNTA: "O que vocês pensam sobre expandir esse CRM para Estados Unidos e Europa? Mais fácil de vender, maior poder de compra."

CONTEXTO DO NEGÓCIO: João, fundador solo da Amply (Brasil), constrói sozinho com IA; também é agência de anúncios Meta no Brasil. Produto no ar há ~3 meses: CRM + bot de IA para lojas de veículos — estoque ao vivo no bot, fotos, agenda visita, áudio, lista de espera, consulta de placa/FIPE (base brasileira), contrato de venda brasileiro, feed de estoque, disparos, atribuição de anúncio Meta (ctwa_clid capturado, envio à Meta não pronto). Canal principal: WhatsApp Business API oficial (coexistência) + Instagram Direct; App Review Meta aprovado 05/10/2026 (vale globalmente). Interface, prompt do bot e textos em português. Cobrança via Asaas (Brasil, em reais). Stack Supabase/React.

TRAÇÃO: 2 clientes brasileiros, vindos da agência, preço negociado; ninguém comprou pela tabela; 1 venda atribuída ao bot. Tabela atual R$1.497–1.997/mês.

OPERAÇÃO: o fundador faz tudo. Incidentes recentes de bot mudo sem erro. Sem testes automatizados.

DECIDIDO HOJE EM OUTROS CONSELHOS: não expandir para outros nichos agora; provar 10 lojas pela tabela com onboarding sem o João; prioridade confiabilidade + card de prova; a hora do João é o gargalo.

FATOS DE MERCADO (aproximados, não verificados): EUA = SMS/telefone/e-mail, CRMs estabelecidos (VinSolutions, DealerSocket, Elead, CDK), startups de IA para concessionárias, TCPA/10DLC. Europa = WhatsApp forte em vários países, muitos idiomas, GDPR, portais locais (mobile.de, AutoScout24, AutoTrader UK). Ticket maior, mas CAC e expectativa de suporte também. Fuso e idioma do fundador.

---

## Respostas dos conselheiros

### O Contrarian

A falha fatal está na premissa: "mais fácil de vender". Isso é falso pelos próprios números. Você não conseguiu vender pela tabela nem no mercado em que tem vantagem total: sua língua, sua rede de agência, o seu fuso, um WhatsApp onipresente e uma base FIPE que nenhum gringo tem. Os 2 clientes vieram de relacionamento e com preço negociado. Se a tabela não fecha onde você joga em casa, ela fecha muito menos onde você é um estranho sem referência, sem case local e sem CNPJ que alguém reconheça.

O que de fato acontece se você for:

1. **EUA.** Você entra num mercado de SMS e telefone com um produto feito para WhatsApp. O diferencial central vira irrelevante. Pra competir, você teria que construir SMS com TCPA/10DLC (multa por mensagem, ação coletiva), integração com DMS (CDK, Reynolds), que é fechada e cara, e brigar com startups de IA com capital de risco e time de vendas. Na prática, você reescreve o produto e chama isso de expansão.

2. **Europa.** "WhatsApp forte" esconde 5 idiomas, 5 portais (mobile.de, AutoScout24...), GDPR com DPA e um contrato de venda para cada país. FIPE, placa e contrato, que são metade do seu valor, morrem na fronteira. Asaas não cobra em euro.

3. **Suporte.** Hoje o bot fica mudo sem gerar erro, não existe teste automatizado e você já é o gargalo. Um bot mudo às 15h de Munique cai na sua madrugada. A primeira concessionária gringa que perder lead vai embora e falar mal de você num mercado onde a reputação é tudo o que você teria.

4. **O "ticket maior" é ilusão.** Ele vem junto com CAC maior, ciclo de venda mais longo e exigência de SOC2, SLA e um suporte em inglês que você não tem.

Isso contradiz o que foi decidido hoje: nada de novos nichos antes de 10 lojas pagando a tabela. Outro país é um nicho novo com dez vezes o atrito. Se 10 lojas no Brasil parecem difíceis, isso é sinal de problema de produto ou de oferta, e a fuga para fora não resolve nenhum dos dois.

Veredito: não. Reabra essa conversa quando o onboarding funcionar sem você.

### O Pensador de Primeiros Princípios

A pergunta está errada. "Expandir para EUA e Europa" pressupõe que já existe algo para expandir. Não existe. São 2 clientes que vieram da agência, com preço negociado, e ninguém comprou pela tabela. Ainda não está provado que esse CRM se vende no Brasil, então não há o que levar para fora.

A frase "mais fácil de vender" esconde uma suposição falsa. A venda não está difícil por causa do poder de compra do brasileiro. Está difícil porque ninguém comprou sem ter o João como ponte. Esse problema vai junto na mala. Em Dallas ou Madri ele chega maior: sem a agência como canal, sem rede de contatos, sem idioma nativo, num fuso que piora o suporte, com expectativa de suporte mais alta e CAC em dólar.

Separando o que é pensado para o Brasil do que é infraestrutura genérica, sobra pouca coisa portável:
- Placa/FIPE, contrato de venda, Asaas, português no prompt e na interface: tudo brasileiro.
- WhatsApp como canal principal: é exatamente a parte que não vale nos EUA.
- O resto é commodity que VinSolutions e as startups de IA americanas já entregam.

A vantagem real da Amply hoje é ser agência Meta + bot no WhatsApp + atribuição de anúncio, num mercado onde o WhatsApp é a rua principal. Isso é uma vantagem de mercado, não de produto. Fora do Brasil ela some.

A pergunta certa é outra: "por que uma loja brasileira que eu não conheço não paga R$1.497?". Se a resposta for preço, a Europa paga mais e o produto continua igual. Se for confiança (bot mudo, onboarding manual, nenhum caso de prova), nenhum país resolve.

Ticket em euro não aumenta a capacidade. A hora do João continua sendo o gargalo, e cada idioma, cada regra (GDPR, TCPA) e cada portal (mobile.de, AutoScout24) consome essa mesma hora.

Pelo raciocínio de primeiros princípios, mercado internacional não é estratégia de crescimento. É o prêmio por ter resolvido a repetibilidade. Quando 10 lojas pagarem pela tabela sem o João no onboarding, aí vale testar Portugal ou Espanha, que têm WhatsApp forte e idioma próximo. EUA ficam por último, se um dia entrarem.

### O Expansionista

Todo mundo vai olhar "EUA e Europa" como um bloco só e dizer não. Esse é o erro. O mercado certo não é um país, é **onde o WhatsApp manda**. E aí o upside é grande.

**1. O caminho mais fácil não está no mapa: é a diáspora.** Existem centenas de revendas de seminovos de donos brasileiros e latinos em Orlando, Miami, Framingham, Newark e Houston. Elas atendem o cliente pelo WhatsApp, em português ou espanhol, e o VinSolutions não foi feito pra elas. O produto atual serve quase sem mudança: mesma língua, mesmo canal. Essa loja paga US$600–900/mês sem negociar, o que dá de 2 a 3 vezes a tabela brasileira. Um cliente desses vale por três aqui, e a hora do João rende o triplo.

**2. Portugal é o Brasil com euro.** É a mesma língua, o WhatsApp domina e o mercado de usados é fragmentado. Trocar a cobrança do Asaas pelo Stripe resolve, e a placa/FIPE vira um módulo que dá pra plugar. É o teste europeu mais barato que existe.

**3. LatAm hispânica é a expansão de verdade.** México, Colômbia, Chile e Argentina usam o WhatsApp de forma ainda mais intensa que o Brasil, e quase ninguém faz bot de estoque ao vivo lá. Traduzir o prompt é trabalho de uma tarde com IA.

**4. O ativo subvalorizado é a Meta.** O App Review aprovado vale no mundo todo. E o produto de verdade é a agência junto com o bot: o anúncio entra, o `ctwa_clid` é capturado, o bot atende e a venda fica atribuída. Isso não precisa ser vendido loja por loja. Dá pra licenciar com marca própria (white-label) para **agências de Meta Ads** de concessionárias lá fora: uma agência traz 20 lojas, e quem faz o onboarding é ela, não o João.

**5. Tabela em dólar é teste de preço.** Se uma loja em Orlando paga US$700 pela tabela, isso prova o valor do produto mais rápido que 10 lojas no Brasil negociando desconto.

Concessionária americana tradicional, com SMS e CRM grande já instalado, fica fora. O alvo são os bolsões de WhatsApp. Primeiro passo: anúncio de Meta segmentado para donos de revenda brasileiros na Flórida, com R$2 mil de verba, nesta semana.

### O Outsider

Sou dono de uma concessionária em Ohio e acabei de ver a sua demo. O que eu enxergo, na ordem em que enxergo:

1. **Nada aqui é o meu mundo.** Placa, FIPE, contrato brasileiro, WhatsApp, Asaas, tudo em português. Meu cliente me manda SMS e liga. Pra mim, "estoque ao vivo no bot" já existe dentro do CRM que eu uso (VinSolutions, Elead), com integração ao DMS, ao Carfax, ao KBB e ao meu site. Você não está me vendendo um produto. Está me pedindo para trocar o sistema nervoso da loja por algo que não fala com nenhum dos meus sistemas.

2. **A primeira pergunta que eu faço é "quantos dealers usam?".** A resposta é dois, os dois no Brasil, a preço negociado. A segunda é "quem me atende quando o bot parar no sábado às 10h?". A resposta é um cara só, num fuso diferente, que já teve bot mudo sem nenhum erro aparecer. Aqui nos EUA, se o bot ignora um lead de US$40 mil, eu cancelo na segunda.

3. **"Mais fácil de vender" está invertido.** Poder de compra maior quer dizer que eu já compro, e de fornecedor com vendedor na rua, referência de outro dealer, show na NADA e contrato de compliance (TCPA). Uma startup estrangeira com um fundador só não entra nem na lista de fornecedores que eu considero.

4. **O europeu vê a mesma coisa, só que multiplicada.** Ele tem WhatsApp, é verdade. Mas um alemão quer o produto em alemão, integração com o mobile.de, GDPR com DPA assinado e servidor na UE. O espanhol quer tudo isso de novo em espanhol.

O que é óbvio de fora e talvez invisível pra você: hoje a vantagem que vocês têm é ser **brasileiro**. WhatsApp como canal principal, FIPE, placa, e a agência de Meta que já traz o cliente. Lá fora, cada uma dessas vantagens vira passivo. Vocês ainda não venderam pela tabela nem em casa. Ir pra fora agora é recomeçar do zero sem nenhuma das armas que têm aqui.

Se um dia fizer sentido sair do Brasil, o vizinho natural é Portugal ou a América Latina, onde o WhatsApp domina e a língua ajuda. Os EUA não são esse vizinho.

### O Executor

Segunda de manhã você não faz nada por EUA nem por Europa. Também não "pesquisa mercado". Isso seria fuga com cara de estratégia. Hoje você tem 2 clientes vindos da agência, ninguém comprou pela tabela e o bot já ficou mudo sem dar erro. Abrir outro país agora multiplica justamente o que já é o gargalo: a sua hora. Fuso diferente, suporte em inglês, onboarding manual do WhatsApp feito por você, GDPR, TCPA e cobrança fora do Asaas. Cada item desses é uma semana sua que não vai para as 10 lojas.

O que dá pra fazer de concreto, em ordem:

1. **Segunda:** escrever o critério que destrava a conversa internacional e colar no topo do backlog: "10 lojas pagando pela tabela, onboarding sem o João, 60 dias sem bot mudo". Antes disso, o assunto não volta à pauta.
2. **Esta semana, custo quase zero:** separar os textos do código (i18n) só nas telas novas que você for criar daqui pra frente. Nada de refatorar o que já existe. Fica preparado sem gastar a semana nisso.
3. **Opção barata pra testar a tese, quando bater o critério:** Portugal. Mesmo idioma, WhatsApp dominante, App Review já vale lá, e o prompt muda pouco. A placa/FIPE vira um campo manual e o contrato vira um modelo em PDF. Para testar, um único anúncio Meta da sua própria agência mirando lojas portuguesas, com teto de 300 euros. Se não sair nenhuma reunião, a tese morre barata.
4. **EUA: descartar por escrito.** Lá o canal é SMS, a concorrência tem CRM pronto e o que o produto tem de diferente (WhatsApp, FIPE, contrato brasileiro) não serve. Seria começar um produto do zero.

"Maior poder de compra" não adianta enquanto ninguém comprou nem pela tabela de R$1.497. Primeiro prove que a tabela vende aqui.

---

## Revisão cruzada

**Mapeamento do anonimato:** A = Expansionista · B = Outsider · C = Executor · D = Contrarian · E = Primeiros Princípios

Placar: **mais forte** → C (Executor) 3 · E (Primeiros Princípios) 2. **Maior ponto cego** → A (Expansionista) 5 de 5.

### Revisor 1
1. **Mais forte: E.** Vai direto ao diagnóstico: o problema real é que ninguém compra sem o João como ponte, e isso viaja junto pra qualquer país, só que maior. A vantagem da Amply é de mercado (agência + WhatsApp), não de produto. C é a mais executável (critério escrito, teto de €300), mas E explica o porquê.

2. **Maior ponto cego: A.** Ela vende a diáspora como "quase sem mudança", mas ignora que lá a placa é americana, não existe FIPE, o contrato muda, a cobrança é em dólar e a TCPA vale mesmo com cliente brasileiro. Também ignora o suporte em outro fuso para um bot que já ficou mudo. E os US$600–900 sem negociar são chute, logo de quem ainda não vendeu pela tabela nem no Brasil.

3. **O que todas deixaram passar:**
- **Agência como veículo.** Gestão de anúncios Meta é serviço sem produto pra adaptar, e foi assim que os 2 clientes chegaram. Vender esse serviço a revendas da diáspora ou de Portugal testa demanda e preço em dólar ou euro sem tocar no código. O CRM entra depois, como complemento. Mas isso também gasta hora do João, que é o gargalo.
- **Custo unitário.** A Meta cobra template por país e EUA/Europa saem bem mais caros que o Brasil. Some IA, câmbio e IOF, e o ticket maior pode virar margem igual ou menor. Ninguém fez essa conta.

### Revisor 2 (ângulo: tese da diáspora; parte legal e fiscal)
1. **A mais forte é a C.** Ela concorda com o diagnóstico da E (a venda depende do João, não do poder de compra) e transforma isso numa trava verificável: 10 lojas pela tabela, onboarding sem o João e 60 dias sem bot mudo. Também descarta os EUA por escrito e só deixa Portugal liberado depois. A D e a E diagnosticam bem, mas não fecham a porta com um critério.

2. **O maior ponto cego é o da A.** "Centenas de revendas" e "US$600–900 sem negociar" são números sem fonte. O anúncio de R$2 mil mede clique, não pagamento. Se converter, o onboarding volta a consumir a hora do João, com um produto sem VIN e sem Carfax, e isso viola o critério das 10 lojas. A também ignora a parte legal e fiscal:
   - Para cobrar em dólar, o Stripe exige empresa no exterior (uma LLC) ou câmbio pela PJ brasileira.
   - A isenção de PIS/COFINS/ISS na exportação de serviço é disputada quando o "resultado" do serviço fica ambíguo.
   - Orlando e Miami estão na Flórida, onde a FTSA (a lei estadual que imita a TCPA) já gerou processos coletivos sobre mensagem automatizada.

   Um ponto a favor da A: o fuso da Flórida (1h de diferença) derruba a objeção de suporte da B e da D nesse nicho. Conclusão: a diáspora é hipótese válida para depois do critério. Hoje é distração.

3. **Todas deixaram passar:** desde abril de 2025 a Meta não entrega template de marketing para números americanos. O disparo, metade do produto, não funciona nos EUA nem para a diáspora. *(Nota do relator: afirmação a confirmar na documentação atual da Meta antes de qualquer decisão.)*

### Revisor 3 (ângulo: motivação por trás da pergunta; tamanho do mercado)
1. **Mais forte: C.** É a única que trata a pergunta como fuga e transforma isso em ação: escreve o critério que libera a expansão ("10 lojas pela tabela, onboarding sem o João, 60 dias sem bot mudo") e só testa Portugal depois de bater esse critério, com teto de €300. E faz o melhor diagnóstico, mas não diz o que fazer na segunda.

2. **Maior ponto cego: A.** Ela promete que a diáspora pagaria "2–3× a tabela sem negociar", sem nenhuma evidência. Ignora que, nos EUA, o suporte cai em outro fuso e o bot mudo vira lead de US$40 mil perdido. Na prática, abre um nicho novo no mesmo dia em que ficou decidido "não multi-nicho". Ainda gasta a hora do João, que é o gargalo, numa campanha "esta semana".

3. **O que todas deixaram passar:**
- **A motivação.** Cinco perguntas de expansão e preço num dia mostram ansiedade com tração, não estratégia. Ninguém nomeou isso nem ofereceu algo para aliviar a ansiedade, como uma meta semanal de vendas.
- **O tamanho do mercado.** O Brasil tem dezenas de milhares de revendas, então tamanho não limita nada. Todas discutiram geografia quando o problema é conversão.
- **O denominador.** Ninguém perguntou para quantas lojas que não conhecem o João a tabela já foi oferecida de verdade. Se a resposta for "quase nenhuma", não existe sinal de que o preço falhou, só falta de tentativas.
- **Os dois clientes atuais.** Ninguém mandou medir se eles renovariam pagando a tabela. Esse é o teste de preço mais barato que existe.

### Revisor 4 (ângulo: agência como veículo; custo Meta por país)
**1. A mais forte é a C.** É a única que vira decisão que dá pra cobrar. Ela escreve o critério que libera a expansão (10 lojas pela tabela, onboarding sem o João, 60 dias sem bot mudo), descarta os EUA por escrito e deixa um teste barato com teto (Portugal, €300). Também nomeia o risco real: "pesquisar mercado" seria fuga com cara de estratégia. A E diagnostica igual, mas não dá passo nenhum.

**2. O maior ponto cego é da A.** Ela supõe que "o produto serve quase sem mudança" e inventa US$600–900 sem nenhum dado. E ignora o que pesa:
- o bot já ficou mudo sem erro;
- suporte em outro fuso, sem ninguém além do João;
- o Asaas não cobra em dólar, e falta empresa ou Stripe pra receber de fora;
- a TCPA e a lei estadual de mensagens também alcançam o WhatsApp.

Pior: manda gastar R$2 mil esta semana, contrariando o que foi decidido hoje. Muda o país, mas a dependência do João continua.

**3. O que todas deixaram passar:**
- Ninguém perguntou de onde veio a ideia. Existe algum lead de fora, ou é cansaço de vender no Brasil?
- O custo é em dólar (LLM e conversa da Meta, com preço diferente por país). Ninguém fez a conta da margem nem notou que cobrar em dólar protege contra o câmbio.
- Os 2 clientes atuais pagariam a tabela na renovação? Esse é o teste de preço mais barato que existe, e ninguém o citou.

### Revisor 5 (ângulo: infraestrutura de dados e GDPR)
1. **A mais forte é a E.** Ela tira a ideia de expandir do "poder de compra" e leva para a causa real: nenhuma loja comprou sem o João no meio. E mostra que esse problema vai junto para qualquer país. A C chega perto e tem o melhor plano para segunda-feira, mas a E acerta melhor a causa.

2. **O maior ponto cego é o da A.** Ela vende a revenda brasileira na Flórida como "quase sem mudança", mas não fala de:
   - conformidade dos EUA: TCPA, termos e leis de privacidade estaduais;
   - suporte em outro fuso, com um produto que já ficou mudo sem dar erro;
   - cobrança em dólar e emissão de nota para cliente de fora;
   - o "traduzir o prompt é uma tarde", que ignora que placa, FIPE e contrato são brasileiros.

   O mercado da diáspora é uma tese que vale a pena. O que a A erra é o quanto custa operar lá.

3. **O que todas deixaram passar foi a infraestrutura.**
   - **Onde os dados ficam:** o banco do Supabase está numa região só. Para vender na Europa, a GDPR exige base legal para mandar dados para fora (cláusulas contratuais padrão), um contrato de tratamento de dados com o cliente e, muitas vezes, servidor dentro da UE. A conversa de WhatsApp é dado pessoal, e o banco teria que ser migrado ou separado em mais de uma região.
   - **Latência:** o webhook, as edge functions e a chamada de IA ficam lentos para quem está longe da região do banco.
   - **Superfície de falha:** com bot mudo, migrations fora de sincronia e deploy frágil, a confiabilidade ainda não está resolvida nem no Brasil. Cada país novo traz outra região, outro idioma e outro horário de suporte, e cada um é mais um jeito de falhar em silêncio.

---

## Veredito do presidente

### Onde o conselho concorda

Os cinco conselheiros chegam à mesma conclusão: **agora, não**. Os motivos se repetem:

- **A premissa "mais fácil de vender" não se sustenta.** Nenhuma loja comprou pela tabela no Brasil, onde a Amply tem idioma, fuso, FIPE, placa, contrato e a agência como canal. Lá fora todas essas vantagens somem.
- **O que pesa é o mercado, não o produto.** A força está em ser um bot de WhatsApp onde o WhatsApp é a rua principal, vendido por uma agência que já tem a confiança da loja. Quase nada disso atravessa a fronteira. O que atravessa (App Review da Meta, o motor do bot) é a parte menos difícil.
- **O gargalo vai junto na mala.** Fundador solo, bot que já ficou mudo sem erro, sem testes. Num fuso de 5 horas de diferença, esse problema passa a acontecer de madrugada, com um cliente que paga mais e cobra mais.
- **EUA tradicional está fora.** O mercado é de SMS (TCPA/10DLC), com DMS fechado, Carfax/KBB e concorrentes capitalizados. Seria um produto novo.
- **Se um dia houver expansão, o vizinho natural é Portugal ou América Latina**, não Ohio nem Munique.

### Onde o conselho diverge

A divergência é sobre **quando e por onde testar**, não sobre o mérito.

- O **Expansionista** quer testar já a diáspora brasileira e latina na Flórida, com R$2 mil em anúncio nesta semana.
- Os outros quatro dizem que isso viola o critério decidido hoje (10 lojas pela tabela, onboarding sem o João).
- O **Executor** e o **Primeiros Princípios** separam a pergunta em duas: a geografia é o prêmio, e a repetibilidade é a condição para ganhar esse prêmio.

A revisão deu razão à maioria. Também reconheceu que a diáspora é a única hipótese internacional com lógica própria: o fuso da Flórida fica a cerca de 1h e o atendimento já é por WhatsApp em português. Por isso ela é a primeira da fila **depois** do critério, não agora.

### Pontos cegos que a revisão pegou

1. **Denominador.** Ninguém sabe para quantas lojas desconhecidas a tabela foi de fato oferecida. Se foi para quase nenhuma, o preço não falhou: faltaram tentativas.
2. **O teste de preço mais barato já está em casa.** É saber se os 2 clientes atuais renovariam pela tabela.
3. **Custo unitário.** Templates da Meta são cobrados por país, e EUA e Europa custam mais. A IA é paga em dólar e ainda há câmbio e IOF. O ticket maior pode virar a mesma margem.
4. **Infraestrutura e GDPR.** O Supabase roda numa região só. A Europa exige DPA, cláusulas-padrão e muitas vezes servidor na UE. Cada região nova abre mais espaço para falha silenciosa, justamente o tipo de defeito que já calou o bot.
5. **Cobrança.** Asaas não cobra em euro. O Stripe exige LLC fora do país ou operação de câmbio pela PJ, e a tributação de exportação de serviço tem detalhes.
6. **Flórida.** Lei estadual (FTSA) com histórico de ações coletivas sobre mensagem automatizada. Além disso, existe a afirmação, **ainda a confirmar na documentação da Meta**, de que templates de marketing não são entregues a números dos EUA desde abril/2025. Se for verdade, os disparos para a diáspora americana morrem.
7. **Agência como veículo.** Vender gestão de anúncios para revendas da diáspora testaria demanda em dólar sem mexer no código, mas também consome a hora do João.

### A recomendação

- **EUA (mercado tradicional): não.** Descartar por escrito. Não é um adiamento, é outro produto.
- **Europa continental: não.** Volta à pauta só depois de Portugal dar certo, se der.
- **Diáspora brasileira e latina, Portugal e LatAm hispânica: sim, mas depois do critério.** Não antes.

**Critério que destrava:** 10 lojas que o João não conhecia, pagando a tabela cheia, com onboarding feito sem ele, e 60 dias seguidos sem bot mudo.

**Ordem quando destravar:**
1. Portugal, que é o Brasil com euro. Mesmo idioma, WhatsApp dominante, App Review já vale. A placa vira campo manual e o contrato vira PDF. Teste com teto de €300 pela própria agência.
2. Diáspora na Flórida, depois de confirmar a regra da Meta sobre templates nos EUA e a exposição à FTSA.
3. LatAm hispânica, que exige i18n de verdade.

Até lá, i18n só em telas novas, sem refatorar nada.

**Sobre a ansiedade de tração:** esta é a quinta pergunta de expansão ou preço no mesmo dia, e todas tentam resolver em outro lugar um problema de conversão que está aqui. O Brasil tem dezenas de milhares de revendas, e você ainda não tentou vender para elas o suficiente para saber se o preço funciona. Mudar de país não cria tração. A tração vem de oferecer a tabela para mais lojas.

### A primeira coisa a fazer

Abrir uma planilha e listar **toda loja desconhecida que já recebeu a tabela de R$1.497–1.997**, com data e resposta. Se tiver menos de 20 linhas, a próxima semana inteira vai para oferecer a tabela a lojas brasileiras, não para pensar em outro país.
