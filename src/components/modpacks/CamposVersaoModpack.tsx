import { SeletorInstanciaModpack } from './SeletorInstanciaModpack';
import type { Instance } from '../../hooks/useLauncher';

interface Props {
    numero: string;
    setNumero: (valor: string) => void;
    canal: string;
    setCanal: (valor: string) => void;
    instanciaId: string;
    instancias: Instance[];
    selecionarInstancia: (id: string) => void;
    caminho: string;
    escolherArquivo: () => void;
    notas: string;
    setNotas: (valor: string) => void;
    mostrarConteudo?: boolean;
}

const classeCampo = 'modpacks-campo mt-2';

export function CamposVersaoModpack(props: Props) {
    return (
        <>
            <div className="grid grid-cols-2 gap-3">
                <label className="min-w-0 text-sm text-white/60">
                    Número da versão
                    <input
                        required
                        pattern="[a-zA-Z0-9._+\-]+"
                        maxLength={32}
                        placeholder="1.0.0"
                        value={props.numero}
                        onChange={(evento) => props.setNumero(evento.target.value)}
                        className={classeCampo}
                    />
                </label>
                <label className="min-w-0 text-sm text-white/60">
                    Canal
                    <select
                        value={props.canal}
                        onChange={(evento) => props.setCanal(evento.target.value)}
                        className={classeCampo}
                    >
                        <option value="release">Estável</option>
                        <option value="beta">Beta</option>
                        <option value="alpha">Alpha</option>
                    </select>
                </label>
            </div>
            {props.mostrarConteudo !== false && <CamposConteudoModpack {...props} />}
            <label className="block text-sm text-white/60">
                Notas da versão
                <textarea
                    maxLength={65536}
                    value={props.notas}
                    onChange={(evento) => props.setNotas(evento.target.value)}
                    className={classeCampo}
                    rows={3}
                />
            </label>
        </>
    );
}

export function CamposConteudoModpack(
    props: Pick<Props, 'instanciaId' | 'instancias' | 'selecionarInstancia' | 'caminho' | 'escolherArquivo'>,
) {
    return (
        <>
            <div className="modpacks-escolha-instancias" role="group" aria-label="Instância da biblioteca">
                <div className="modpacks-titulo-instancia">
                    <p className="modpacks-label">Instância da biblioteca</p>
                    <button
                        type="button"
                        onClick={props.escolherArquivo}
                        className="modpacks-anexar max-w-full self-start"
                    >
                        <span className="block truncate">
                            {props.caminho ? props.caminho.split(/[\\/]/).pop() : 'Anexar .dome'}
                        </span>
                    </button>
                </div>
                <SeletorInstanciaModpack
                    instancias={props.instancias}
                    instanciaId={props.instanciaId}
                    selecionar={props.selecionarInstancia}
                />
                {!props.instancias.length && <p className="modpacks-ajuda">Nenhuma instância própria disponível.</p>}
            </div>
        </>
    );
}
