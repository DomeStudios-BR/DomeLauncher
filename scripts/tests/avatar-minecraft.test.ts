import { describe, expect, test } from 'bun:test';
import { escolherUuidAvatar, obterUrlCabecaMinecraft } from '../../src/lib/avatarMinecraft';

const principal = '11111111111111111111111111111111';
const ativa = 'abcdefabcdefabcdefabcdefabcdefab';
const perfil = {
    contaMinecraftPrincipalUuid: principal,
    contasMinecraftVinculadas: [
        { uuid: principal, nome: 'Principal', vinculadoEm: '' },
        { uuid: ativa, nome: 'Ativa', vinculadoEm: '' },
    ],
};

describe('cabeça Minecraft do perfil', () => {
    test('mantém a identidade ao renderizar a cabeça em tamanhos diferentes', () => {
        expect(obterUrlCabecaMinecraft(escolherUuidAvatar(perfil))).toBe(`https://mc-heads.net/head/${principal}/64`);
        expect(obterUrlCabecaMinecraft(escolherUuidAvatar(perfil), 256)).toBe(`https://mc-heads.net/head/${principal}/256`);
    });
    test('usa a conta ativa vinculada mesmo quando a principal é outra', () => {
        expect(escolherUuidAvatar(perfil, ativa)).toBe(ativa);
        expect(escolherUuidAvatar(perfil, 'ABCDEFAB-CDEF-ABCD-EFAB-CDEFABCDEFAB')).toBe(ativa);
    });
    test('visitantes usam a principal e o próprio perfil usa a ativa mesmo durante o vínculo', () => {
        expect(escolherUuidAvatar(perfil)).toBe(principal);
        expect(escolherUuidAvatar(perfil, '22222222222222222222222222222222')).toBe('22222222222222222222222222222222');
    });
    test('usa a conta vinculada sem principal e a conta ativa enquanto o perfil carrega', () => {
        expect(escolherUuidAvatar({ ...perfil, contaMinecraftPrincipalUuid: null })).toBe(principal);
        expect(escolherUuidAvatar(null, ativa)).toBe(ativa);
        expect(escolherUuidAvatar(null)).toBeNull();
    });
});
