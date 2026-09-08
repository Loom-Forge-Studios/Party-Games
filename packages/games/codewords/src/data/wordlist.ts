// Original wordlist for Codewords — see docs/ARCHITECTURE.md §7 ("no
// trademarked game titles, no reproduced third-party content") and this
// package's index.ts header. Every entry below was authored for this repo:
// everyday, common, concrete nouns (nature, animals, household objects,
// tools, food, places, ...), not drawn from any published word-association
// game's list and not trademarked. Stored as data (not inline in the
// reducer) so it can be swapped/extended without touching game logic.
//
// setup() draws 25 of these per game via ctx.rng.shuffle — never
// Math.random() — so board composition stays deterministic and testable.

export const WORDLIST: readonly string[] = [
  // Nature & geography
  'river', 'mountain', 'forest', 'desert', 'island', 'volcano', 'glacier',
  'canyon', 'valley', 'ocean', 'lake', 'waterfall', 'cave', 'cliff',
  'meadow', 'swamp', 'jungle', 'reef', 'iceberg', 'dune', 'delta', 'plateau',
  'peninsula', 'harbor',

  // Weather & sky
  'storm', 'cloud', 'rainbow', 'thunder', 'lightning', 'snow', 'ice',
  'wind', 'tornado', 'hurricane', 'sun', 'moon', 'star', 'planet', 'comet',
  'meteor', 'galaxy', 'tide', 'wave', 'fog', 'mist', 'frost', 'rain',
  'eclipse',

  // Minerals & materials
  'stone', 'rock', 'sand', 'mud', 'clay', 'crystal', 'diamond', 'gold',
  'silver', 'copper', 'iron', 'coal', 'marble', 'granite', 'chalk', 'salt',
  'glass', 'rubber', 'leather', 'wax',

  // Plants
  'tree', 'flower', 'rose', 'oak', 'pine', 'cactus', 'vine', 'root', 'leaf',
  'branch', 'seed', 'grass', 'moss', 'mushroom', 'bamboo', 'fern', 'thorn',
  'petal', 'orchard', 'garden', 'blossom', 'weed',

  // Animals
  'lion', 'tiger', 'elephant', 'giraffe', 'zebra', 'bear', 'wolf', 'fox',
  'rabbit', 'deer', 'horse', 'cow', 'pig', 'sheep', 'goat', 'chicken',
  'duck', 'goose', 'owl', 'eagle', 'hawk', 'sparrow', 'crow', 'penguin',
  'dolphin', 'whale', 'shark', 'octopus', 'crab', 'lobster', 'turtle',
  'frog', 'snake', 'lizard', 'spider', 'bee', 'ant', 'butterfly',
  'dragonfly', 'beetle', 'snail', 'squirrel', 'raccoon', 'otter', 'beaver',
  'bat', 'kangaroo', 'koala', 'panda', 'monkey', 'camel', 'donkey',
  'peacock', 'flamingo', 'jellyfish', 'seahorse', 'walrus', 'hedgehog',
  'moose', 'antelope',

  // Body
  'hand', 'foot', 'eye', 'ear', 'nose', 'mouth', 'tooth', 'tongue', 'heart',
  'brain', 'bone', 'skin', 'hair', 'finger', 'thumb', 'elbow', 'knee',
  'shoulder', 'spine', 'lung',

  // Food & drink
  'apple', 'banana', 'orange', 'grape', 'lemon', 'strawberry', 'pineapple',
  'mango', 'peach', 'cherry', 'watermelon', 'coconut', 'bread', 'cheese',
  'butter', 'egg', 'milk', 'honey', 'sugar', 'pepper', 'rice', 'wheat',
  'corn', 'potato', 'carrot', 'onion', 'garlic', 'tomato', 'cucumber',
  'pumpkin', 'soup', 'cake', 'pie', 'cookie', 'chocolate', 'coffee', 'tea',
  'juice', 'noodle', 'pancake', 'popcorn', 'pretzel', 'sausage',

  // Household objects
  'table', 'chair', 'sofa', 'lamp', 'mirror', 'window', 'door', 'curtain',
  'carpet', 'pillow', 'blanket', 'bed', 'shelf', 'closet', 'drawer',
  'clock', 'candle', 'vase', 'bucket', 'broom', 'mop', 'sponge', 'towel',
  'soap', 'bottle', 'jar', 'plate', 'bowl', 'cup', 'fork', 'spoon', 'knife',
  'pot', 'pan', 'oven', 'sink', 'faucet', 'key', 'lock', 'basket', 'rug',

  // Tools
  'hammer', 'nail', 'screw', 'wrench', 'saw', 'drill', 'ladder', 'rope',
  'chain', 'wire', 'tape', 'glue', 'scissors', 'needle', 'thread', 'brush',
  'paint', 'shovel', 'rake', 'axe', 'anvil', 'bolt',

  // Vehicles
  'car', 'truck', 'bus', 'train', 'bicycle', 'motorcycle', 'boat', 'ship',
  'canoe', 'kayak', 'submarine', 'airplane', 'helicopter', 'rocket',
  'balloon', 'sled', 'wagon', 'wheel', 'engine', 'anchor', 'sail', 'raft',

  // Places & structures
  'house', 'castle', 'tower', 'bridge', 'tunnel', 'church', 'temple',
  'palace', 'museum', 'library', 'school', 'hospital', 'farm', 'barn',
  'factory', 'market', 'lighthouse', 'fountain', 'stadium', 'theater',
  'airport', 'station', 'tent', 'cabin', 'village', 'city', 'road',
  'street', 'park', 'well', 'gate', 'fence', 'stairway', 'chimney',

  // Clothing & accessories
  'shirt', 'jacket', 'coat', 'hat', 'cap', 'scarf', 'glove', 'sock', 'shoe',
  'boot', 'belt', 'button', 'zipper', 'dress', 'skirt', 'necktie',
  'umbrella', 'ring', 'necklace', 'crown', 'bracelet',

  // Instruments & sport
  'guitar', 'piano', 'drum', 'violin', 'trumpet', 'flute', 'harp', 'bell',
  'whistle', 'ball', 'puck', 'net', 'goal', 'racket', 'skate', 'ski',

  // Technology & measurement
  'telescope', 'microscope', 'magnet', 'battery', 'compass', 'map',
  'globe', 'satellite', 'robot', 'computer', 'camera', 'phone', 'radio',
  'television', 'ruler', 'scale',

  // Everyday objects
  'book', 'pen', 'pencil', 'paper', 'letter', 'envelope', 'stamp',
  'ticket', 'coin', 'wallet', 'bag', 'box', 'kite', 'puzzle', 'mask',
  'flag', 'banner', 'torch', 'lantern', 'chest', 'treasure', 'sword',
  'shield', 'arrow', 'bow', 'spear',

  // Time & abstract-but-concrete
  'dawn', 'dusk', 'night', 'morning', 'season', 'calendar', 'shadow',
  'echo', 'horizon', 'summit',
] as const;
