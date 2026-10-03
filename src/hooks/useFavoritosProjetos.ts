import { useEffect, useState } from 'react';
import { consultarFavoritos, EVENTO_FAVORITOS_ATUALIZADOS, type ContagemFavoritos,
    type ProjetoFavorito } from '../services/favoritosProjetos';

export function useFavoritosProjetos(projetos: ProjetoFavorito[]) {
    const [contagens, setContagens] = useState<Record<string, ContagemFavoritos>>({});
    const [revisao, setRevisao] = useState(0);
    const assinatura = JSON.stringify(projetos);
    useEffect(() => {
        const atualizar = () => setRevisao((valor) => valor + 1);
        window.addEventListener(EVENTO_FAVORITOS_ATUALIZADOS, atualizar);
        const intervalo = window.setInterval(atualizar, 60000);
        return () => {
            window.removeEventListener(EVENTO_FAVORITOS_ATUALIZADOS, atualizar);
            window.clearInterval(intervalo);
        };
    }, []);
    useEffect(() => {
        if (assinatura === "[]") return;
        let cancelado = false;
        const timer = window.setTimeout(() => {
            void consultarFavoritos(JSON.parse(assinatura)).then((lista) => {
                if (cancelado) return;
                setContagens(Object.fromEntries(lista.map((item) => [`${item.source}:${item.projectId}`, item])));
            }).catch(() => undefined);
        }, 100);
        return () => { cancelado = true; window.clearTimeout(timer); };
    }, [assinatura, revisao]);
    return { contagens, revisao };
}
