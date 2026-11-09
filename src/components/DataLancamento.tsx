import { Calendar } from "../iconesPixelados";

const formatadorData = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

interface PropriedadesDataLancamento {
    data?: string | null;
    className: string;
    mostrarRotulo?: boolean;
}

export function DataLancamento({ data, className, mostrarRotulo }: PropriedadesDataLancamento) {
    if (!data) return null;

    const instante = new Date(data);
    if (!Number.isFinite(instante.getTime())) return null;

    const dataFormatada = formatadorData.format(instante);
    const rotulo = `Lançado em ${dataFormatada}`;
    return (
        <time dateTime={data} title={rotulo} aria-label={rotulo} className={className}>
            {!mostrarRotulo && <Calendar size={12} aria-hidden="true" className="shrink-0" />}
            {mostrarRotulo ? `Lançou: ${dataFormatada}` : dataFormatada}
        </time>
    );
}
