import { describe, expect, test } from 'bun:test';
import { montarCapturasFavoritas, montarInstanciasFavoritas } from '../../src/lib/personalizacaoPerfil';

const captura = {
    id: 'instancia:captura.png', nome: 'captura.png', instanciaNome: 'Sobrevivência',
    criadaEm: '2026-09-30', imagemUrl: 'https://api.domestudios.com.br/api/launcher/perfis/midias/perfil/captura.png',
};
const instancia = {
    id: 'instancia', nome: 'Sobrevivência', versao: '1.21', carregador: 'Fabric',
    iconeUrl: 'https://api.domestudios.com.br/api/launcher/perfis/midias/perfil/icone.png',
    horasJogadas: 12, ultimaVez: '2026-09-30',
};

describe('salvamento de favoritos do perfil', () => {
    test('salvar sem alterações mantém capturas e instâncias sem arquivos locais carregados', () => {
        expect(montarCapturasFavoritas([captura.id], [captura], [])).toEqual([{
            id: captura.id, nome: captura.nome, instanciaNome: captura.instanciaNome,
            criadaEm: captura.criadaEm, dadosUrl: captura.imagemUrl,
        }]);
        expect(montarInstanciasFavoritas([instancia.id], [instancia], [])).toEqual([instancia]);
    });
    test('respeita remoção explícita e a ordem escolhida ao misturar capturas remotas e locais', () => {
        const local = {
            instanciaId: 'outra', nome: 'nova.png', instanciaNome: 'Criativo', criadaEm: null,
            dadosUrl: 'data:image/png;base64,imagem',
        };
        const selecionadas = montarCapturasFavoritas(['outra:nova.png', captura.id], [captura], [local]);
        expect(selecionadas.map((item) => item.id)).toEqual(['outra:nova.png', captura.id]);
        expect(selecionadas[0].dadosUrl).toBe(local.dadosUrl);
        expect(montarCapturasFavoritas([], [captura], [])).toEqual([]);
        expect(montarInstanciasFavoritas([], [instancia], [])).toEqual([]);
    });
    test('interrompe o salvamento quando um favorito não pode ser resolvido', () => {
        expect(() => montarCapturasFavoritas(['ausente'], [], [])).toThrow();
        expect(() => montarInstanciasFavoritas(['ausente'], [], [])).toThrow();
    });
});
