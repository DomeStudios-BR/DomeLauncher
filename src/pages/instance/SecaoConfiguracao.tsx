import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "../../iconesPixelados";
import { cn } from "../../lib/utils";

interface SecaoConfiguracaoProps {
    titulo: string;
    icone?: ReactNode;
    children: ReactNode;
}

export default function SecaoConfiguracao({ titulo, icone, children }: SecaoConfiguracaoProps) {
    const [aberta, setAberta] = useState(false);
    const id = useId();

    return (
        <section className="mr-auto max-w-3xl overflow-hidden border border-white/10 bg-[#171717]">
            <h2>
                <button
                    id={`${id}-titulo`}
                    type="button"
                    aria-expanded={aberta}
                    aria-controls={`${id}-conteudo`}
                    onClick={() => setAberta((anterior) => !anterior)}
                    className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors
                        hover:bg-white/[0.025] focus-visible:outline-2 focus-visible:-outline-offset-2
                        focus-visible:outline-emerald-400/60"
                >
                    {icone && (
                        <span className="grid h-9 w-9 shrink-0 place-items-center border border-white/10
                            bg-white/[0.025] text-emerald-300/75" aria-hidden="true">
                            {icone}
                        </span>
                    )}
                    <span className="flex-1 text-sm font-bold text-white/90">{titulo}</span>
                    <ChevronDown size={15} aria-hidden="true" className={cn(
                        "shrink-0 text-white/40 transition-transform duration-200",
                        aberta && "rotate-180",
                    )} />
                </button>
            </h2>
            <div id={`${id}-conteudo`} role="region" aria-labelledby={`${id}-titulo`} hidden={!aberta}
                className="border-t border-white/8">
                {children}
            </div>
        </section>
    );
}
