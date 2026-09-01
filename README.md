# 📊 Control Tower | Gerador de Programação

Ferramenta que converte a programação de rotas em PDF para planilhas Excel prontas para a operação logística. 
Roda inteiramente no navegador, nenhum arquivo é enviado a servidores externos.

## O que faz

- Lê o PDF de programação e extrai rota, loja, dia/hora de entrega e carregamento, e volumes (caixas)
- Resolve o *CD de origem* e a *transportadora* de cada rota por uma tabela de referência embutida (prefixo da rota → CD → transportadora → planilha de saída)
- Cria automaticamente *linhas de retorno ao CD* para rotas elegíveis, com base no histórico acumulado
- Gera o Excel final preservando fórmulas e formatação do modelo original, *dividido em uma planilha por grupo de CD*, nomeada com a semana do faturamento (ex: Tbl_DistrMCD_ES_RJ_Sem35.xlsx)

## Estrutura

site/
├── index.html
├── css/style.css
├── js/
│   ├── app.js          # interface e orquestração
│   ├── core-logic.js   # extração do PDF, validação, geração do Excel
│   └── db.js           # histórico local (IndexedDB)
├── data/
│   ├── prefixo_cd_transportadora.js  # tabela de referência (editável)
│   ├── modelo-excel.xlsx             # modelo oficial
│   └── backup_data.js                # carga inicial de histórico
└── vendor/                           # ExcelJS e PDF.js

## Configuração

Fica na aba *Configurações* do site, ou direto em data/prefixo_cd_transportadora.js:

- *Prefixo → CD → Transportadora → Planilha*: única fonte para origem, elegibilidade de retorno automático e agrupamento do Excel de saída
- *Origem padrão*: usada só quando o prefixo da rota não está cadastrado na tabela

## Limitações conhecidas

- Retorno automático ao CD só é criado para rotas com evidência histórica prévia — rotas novas não recebem
- A tabela de referência não é editável pela interface; atualizações exigem substituir o arquivo de dados
