const FUSO_BRASILIA = 'America/Sao_Paulo';

/**
 * Formata uma data de calendário vinda da API ("2026-11-13T00:00:00") como
 * "13/11/2026". Lê direto a parte "YYYY-MM-DD": passar por `new Date()`
 * trataria o valor como meia-noite UTC e mostraria o dia anterior no Brasil.
 */
export function formatarDataCalendario(valor: string | null | undefined): string | null {
  const partes = valor?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!partes) return null;
  const [, ano, mes, dia] = partes;
  return `${dia}/${mes}/${ano}`;
}

// Instantes chegam em UTC com "Z"; se algum vier sem fuso, assume UTC também.
function paraDate(instante: string): Date {
  const temFuso = /(Z|[+-]\d{2}:?\d{2})$/i.test(instante);
  return new Date(temFuso ? instante : `${instante}Z`);
}

/** Instante UTC → "13/11/2026 08:05" no horário de Brasília. */
export function formatarDataHoraBrasilia(instante: string): string {
  return paraDate(instante)
    .toLocaleString('pt-BR', {
      timeZone: FUSO_BRASILIA,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(',', '');
}

/** Instante UTC → "08:05" no horário de Brasília. */
export function formatarHoraBrasilia(instante: string): string {
  return paraDate(instante).toLocaleTimeString('pt-BR', {
    timeZone: FUSO_BRASILIA,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Instante UTC → milissegundos, pra calcular intervalos. */
export function instanteEmMs(instante: string): number {
  return paraDate(instante).getTime();
}

/** Dia de hoje em Brasília como "YYYY-MM-DD" (toISOString usaria o dia em UTC). */
export function hojeEmBrasilia(): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO_BRASILIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

/** "2024-03-15T00:00:00" → "2024-03-15" (a parte de calendário, sem passar por Date). */
export function dataIso(valor: string | null | undefined): string | null {
  return valor?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function partesIso(iso: string): [number, number, number] {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return [ano, mes, dia];
}

// Date.UTC trata os anos 0 a 99 como 1900 a 1999; setUTCFullYear não.
function dataUtc(ano: number, mes: number, dia: number): Date {
  const data = new Date(0);
  data.setUTCFullYear(ano, mes - 1, dia);
  return data;
}

function paraIso(data: Date): string {
  const ano = String(data.getUTCFullYear()).padStart(4, '0');
  const mes = String(data.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(data.getUTCDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/** Soma (ou subtrai) dias a uma data "YYYY-MM-DD". */
export function somarDias(iso: string, dias: number): string {
  const [ano, mes, dia] = partesIso(iso);
  return paraIso(dataUtc(ano, mes, dia + dias));
}

/** Soma (ou subtrai) anos a uma data "YYYY-MM-DD"; 29/02 vira 28/02 em ano não bissexto. */
export function somarAnos(iso: string, anos: number): string {
  const [ano, mes, dia] = partesIso(iso);
  const ultimoDiaDoMes = dataUtc(ano + anos, mes + 1, 0).getUTCDate();
  return paraIso(dataUtc(ano + anos, mes, Math.min(dia, ultimoDiaDoMes)));
}
