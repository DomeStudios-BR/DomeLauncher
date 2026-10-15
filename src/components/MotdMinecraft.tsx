import { interpretarMotd } from "../lib/motdMinecraft";

/** Exibe mensagens de servidores preservando cores, estilos e quebras de linha do MOTD. */
export function MotdMinecraft({ valor, className }: { valor: unknown; className?: string }) {
    const trechos = interpretarMotd(valor);
    return (
        <span className={className} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {trechos.map(({ texto, estilo }, indice) => (
                <span key={indice} style={{
                    color: estilo.color,
                    fontWeight: estilo.bold ? 700 : 400,
                    fontStyle: estilo.italic ? "italic" : "normal",
                    textDecoration: [estilo.underlined && "underline", estilo.strikethrough && "line-through"]
                        .filter(Boolean).join(" ") || "none",
                }}>{texto}</span>
            ))}
        </span>
    );
}
