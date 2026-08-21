import Cliente from "./cliente";
import Telefone from "./telefone";
import Endereco from "./endereco";

let telefone = new Telefone('11', '99999-9999');
let endereco = new Endereco('SP', 'São Paulo', 'Avenida Paulista', '987');
let cliente = new Cliente('Carlos Conrado', telefone, 'carlos@gmail.com', endereco);

cliente.descricao()