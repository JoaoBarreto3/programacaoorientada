import Empresa from "./empresa.js";
import Cliente from "./cliente.js";
import Endereco from "./endereco.js";
import Telefone from "./telefone.js";

const enderecoEmpresa = new Endereco("1007 Mountain Drive", "1007", "NJ", "Gotham City");
const telefonesEmpresa = [
  new Telefone("12", "3333-1000"),
  new Telefone("12", "99999-1000")
];

const empresa = new Empresa(
  "Wayne Enterprises S.A.",
  "WayneCorp",
  "12.345.678/0001-90",
  enderecoEmpresa,
  telefonesEmpresa
);

const cliente1 = new Cliente(
  "Jean",
  new Endereco("Rua Jessen Vidal", "123", "SP", "São José dos Campos"),
  "111.222.333-44",
  [new Telefone("12", "9999-9999"), new Telefone("12", "98888-7777")]
);
empresa.adicionarCliente(cliente1);

const cliente2 = new Cliente(
  "Joao Victor",
  new Endereco("Rua Paraibuna", "321", "SP", "Paraibuna"),
  "111.456.633-84",
  [new Telefone("11", "8888-8888"), new Telefone("11", "98345-7755")]
);
empresa.adicionarCliente(cliente2);

const cliente3 = new Cliente(
  "Arakaki",
  new Endereco("Rua Texas", "123", "SP", "Taubaté"),
  "222.333.444-55",
  [new Telefone("12", "9999-9999"), new Telefone("12", "98888-7777")]
);
empresa.adicionarCliente(cliente3);

const cliente4 = new Cliente(
  "Benedito",
  new Endereco("Rua da Secretaria", "45", "SP", "Metrópoles"),
  "333.444.555-66",
  [new Telefone("19", "3222-1111"), new Telefone("19", "98111-2222")]
);
empresa.adicionarCliente(cliente4);

const cliente5 = new Cliente(
  "Edydio Antonio",
  new Endereco("Rua Unifesp", "789", "SP", "São José dos Campos"),
  "444.555.666-77",
  [new Telefone("21", "2555-3333"), new Telefone("21", "99444-5555")]
);
empresa.adicionarCliente(cliente5);

empresa.detalhe();
