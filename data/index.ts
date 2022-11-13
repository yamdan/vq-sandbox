import {
  customLoader,
  builtinDIDDocs,
  builtinContexts,
} from "./customDocumentLoader.js";

import exampleBls12381KeyPair from "./data/exampleBls12381KeyPair.json" assert { type: 'json' };
import exampleEd25519KeyPair from "./data/did_example_b34ca6cd37bbf23_test.json" assert { type: 'json' };
import expExampleBls12381KeyPair from "./data/exp_exampleBls12381KeyPair.json" assert { type: 'json' };
import expExampleBls12381KeyPair2 from "./data/exp_exampleBls12381KeyPair2.json" assert { type: 'json' };
import expExampleBls12381KeyPair3 from "./data/exp_exampleBls12381KeyPair3.json" assert { type: 'json' };
import issuerKeyPairs from "./data/issuerKeyPairs.json" assert { type: 'json' };

export {
  customLoader,  
  builtinDIDDocs,
  builtinContexts,
  exampleBls12381KeyPair,
  exampleEd25519KeyPair,
  expExampleBls12381KeyPair,
  expExampleBls12381KeyPair2,
  expExampleBls12381KeyPair3,
  issuerKeyPairs,
};
