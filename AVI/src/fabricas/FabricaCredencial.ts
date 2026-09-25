import Credencial, { ITERACOES_PADRAO, gerarSaltEHash } from "../dominio/Credencial";
import PapelUsuario from "../dominio/enums/PapelUsuario";

export type RegistroCredencial = {
    id: string; usuario: string; hashSenha: string; salt: string; ultimoAcesso: string; papel: PapelUsuario;
};

export default class FabricaCredencial {
    public static criar(usuario: string, senha: string, papel: PapelUsuario, iteracoes: number = ITERACOES_PADRAO): Credencial {
        return new Credencial({ usuario, papel, ultimoAcesso: new Date(), ...gerarSaltEHash(senha, iteracoes) });
    }

    public static paraRegistro(c: Credencial): RegistroCredencial {
        return {
            id: c.usuario, usuario: c.usuario, hashSenha: c.hashSenha, salt: c.salt,
            ultimoAcesso: c.ultimoAcesso.toISOString(), papel: c.papel
        };
    }

    public static deRegistro(r: RegistroCredencial): Credencial {
        return new Credencial({ ...r, ultimoAcesso: new Date(r.ultimoAcesso) });
    }
}
