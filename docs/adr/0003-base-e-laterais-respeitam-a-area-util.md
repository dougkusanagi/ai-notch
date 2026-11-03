# 0003. Base e laterais respeitam a área útil do monitor

- Status: Aceito
- Data: 2026-11-01

## Contexto

A primeira versão da base encostava na borda real do monitor e cobria a barra de tarefas. O usuário queria o notch acima dela. Em alguns casos o notch também sumia atrás da barra.

## Decisão

O topo continua colado na borda da tela. A base e as laterais usam a área útil (`workArea`) do monitor, ficando acima ou ao lado da barra de tarefas. As janelas reafirmam o "sempre no topo" a cada 3 segundos, porque o Windows pode trazer a barra para a frente delas.

## Alternativas

- Cobrir a barra de tarefas: foi a primeira versão e o usuário rejeitou.
- Só reafirmar o topo quando houver evento: o Windows não avisa quando a barra passa à frente.

## Consequências

- Mudar o tamanho ou a posição da barra reposiciona o notch (evento de métricas do monitor).
- Um temporizador de 3 segundos fica ativo enquanto o app roda.
