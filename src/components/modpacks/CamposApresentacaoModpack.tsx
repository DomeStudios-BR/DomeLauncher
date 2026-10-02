import { useState } from 'react';
import { createPortal } from 'react-dom';
import EditorIconeModal from '../editor-icone/EditorIconeModal';
import { EditorDescricaoModpack } from './EditorDescricaoModpack';
import { obterImagemProjeto } from '../../lib/imagemProjeto';
import { Image } from '../../iconesPixelados';

interface Props {
    aba: string;
    aoOcupado: (valor: boolean) => void;
    nome: string;
    setNome: (valor: string) => void;
    descricao: string;
    setDescricao: (valor: string) => void;
    corpo: string;
    setCorpo: (valor: string) => void;
    foto?: string;
    escolherFoto: (icone: string) => void;
}

export function CamposApresentacaoModpack(props: Props) {
    const [editandoIcone, setEditandoIcone] = useState(false);
    if (props.aba === 'descricao')
        return <EditorDescricaoModpack valor={props.corpo} aoAlterar={props.setCorpo} aoOcupado={props.aoOcupado} />;

    return (
        <>
            <div className="modpacks-foto">
                <img src={obterImagemProjeto(props.foto, 'modpack', 'editor')} alt="Foto do modpack" />
                <div>
                    <button className="modpacks-botao" type="button" onClick={() => setEditandoIcone(true)}>
                        <Image size={14} /> Editar ícone
                    </button>
                </div>
            </div>
            {editandoIcone &&
                createPortal(
                    <div data-editor-icone-modpack>
                        <EditorIconeModal
                            aberto
                            iconeAtual={props.foto}
                            limiteImagemBytes={null}
                            aoFechar={() => setEditandoIcone(false)}
                            aoSalvar={(icone) => {
                                props.escolherFoto(icone);
                                setEditandoIcone(false);
                            }}
                        />
                    </div>,
                    document.body,
                )}
            <label className="modpacks-label">
                Nome
                <input
                    className="modpacks-campo"
                    required
                    minLength={3}
                    maxLength={64}
                    value={props.nome}
                    placeholder="Nome do modpack"
                    onChange={(evento) => props.setNome(evento.target.value)}
                />
            </label>
            <label className="modpacks-label">
                Resumo
                <textarea
                    className="modpacks-campo"
                    required
                    minLength={3}
                    maxLength={512}
                    rows={3}
                    placeholder="Uma breve apresentação para o Explorar"
                    value={props.descricao}
                    onChange={(evento) => props.setDescricao(evento.target.value)}
                />
            </label>
        </>
    );
}
