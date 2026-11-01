# 0008. Renomear o repositório para ai-notch

- Status: Aceito
- Data: 2026-11-01

## Contexto

O projeto começou como extensão GNOME ("AI Usage") e ganhou o app de Windows, que tem forma de notch. O nome `ai-usage-island` já não descrevia os dois.

## Decisão

O repositório no GitHub passa a se chamar `dougkusanagi/ai-notch`. O remoto `origin` local foi atualizado. A pasta local não foi renomeada.

## Alternativas

- Manter o nome: confunde quem procura o app de Windows.

## Consequências

- O GitHub redireciona o endereço antigo, mas links fixos e clones precisam trocar o remoto.
- O nome de pacote, o `appId` e o diretório de dados (`ai-quota-notch`) não mudaram, para não perder preferências já salvas.
