const CORES_MINECRAFT: Record<string, string> = {
    black: "#000000", dark_blue: "#0000aa", dark_green: "#00aa00", dark_aqua: "#00aaaa",
    dark_red: "#aa0000", dark_purple: "#aa00aa", gold: "#ffaa00", gray: "#aaaaaa",
    dark_gray: "#555555", blue: "#5555ff", green: "#55ff55", aqua: "#55ffff",
    red: "#ff5555", light_purple: "#ff55ff", yellow: "#ffff55", white: "#ffffff",
};
const CORES_LEGADAS = Object.values(CORES_MINECRAFT);
const FORMATOS = ["bold", "italic", "underlined", "strikethrough"] as const;

interface EstiloMotd {
    color?: string;
    bold?: boolean;
    italic?: boolean;
    underlined?: boolean;
    strikethrough?: boolean;
}

interface TrechoMotd {
    texto: string;
    estilo: EstiloMotd;
}

function obterCor(valor: unknown): string | undefined {
    if (typeof valor !== "string") return undefined;
    if (Object.prototype.hasOwnProperty.call(CORES_MINECRAFT, valor)) return CORES_MINECRAFT[valor];
    return /^#[\da-f]{6}$/i.test(valor) ? valor : undefined;
}

function lerTextoLegado(texto: string, herdado: EstiloMotd): TrechoMotd[] {
    const trechos: TrechoMotd[] = [];
    const codigos = /§x(?:§[\da-f]){6}|§#[\da-f]{6}|§[\da-fk-or]/gi;
    let estilo = { ...herdado };
    let inicio = 0;
    for (const codigo of texto.matchAll(codigos)) {
        const indice = codigo.index;
        if (indice > inicio) trechos.push({ texto: texto.slice(inicio, indice), estilo });
        const formato = codigo[0].slice(1).toLowerCase();
        const cor = formato[0] === "x" ? `#${formato.slice(1).split("§").join("")}`
            : formato[0] === "#" ? formato : CORES_LEGADAS[parseInt(formato, 16)];
        if (cor) estilo = { color: cor };
        else if (formato === "r") estilo = {};
        else if (formato === "l") estilo = { ...estilo, bold: true };
        else if (formato === "o") estilo = { ...estilo, italic: true };
        else if (formato === "n") estilo = { ...estilo, underlined: true };
        else if (formato === "m") estilo = { ...estilo, strikethrough: true };
        inicio = indice + codigo[0].length;
    }
    if (inicio < texto.length) trechos.push({ texto: texto.slice(inicio), estilo });
    return trechos;
}

/** Converte respostas de status Minecraft em trechos seguros para exibir o MOTD sem interpretar HTML. */
export function interpretarMotd(valor: unknown): TrechoMotd[] {
    const trechos: TrechoMotd[] = [];
    let visitados = 0;
    let caracteres = 0;

    function visitar(componente: unknown, herdado: EstiloMotd, profundidade: number): EstiloMotd {
        if (++visitados > 1024 || profundidade > 32 || caracteres >= 16384) return herdado;
        if (typeof componente === "string") {
            const texto = componente.slice(0, 16384 - caracteres);
            caracteres += texto.length;
            trechos.push(...lerTextoLegado(texto, herdado));
            return herdado;
        }
        if (Array.isArray(componente)) {
            if (!componente.length) return herdado;
            const estiloBase = visitar(componente[0], herdado, profundidade + 1);
            for (const filho of componente.slice(1, 1024)) visitar(filho, estiloBase, profundidade + 1);
            return estiloBase;
        }
        if (!componente || typeof componente !== "object") return herdado;
        const objeto = componente as Record<string, unknown>;
        const estilo = objeto.color === "reset" ? {} : { ...herdado };
        const cor = obterCor(objeto.color);
        if (cor) estilo.color = cor;
        for (const formato of FORMATOS) {
            if (typeof objeto[formato] === "boolean") estilo[formato] = objeto[formato];
        }
        visitar(objeto.text ?? objeto.fallback ?? objeto.translate, estilo, profundidade + 1);
        if (Array.isArray(objeto.extra)) {
            for (const filho of objeto.extra.slice(0, 1024)) visitar(filho, estilo, profundidade + 1);
        }
        return estilo;
    }

    visitar(valor, {}, 0);
    return trechos;
}
