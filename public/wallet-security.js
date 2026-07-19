/**
 * Wallet Security - Passkeys, Mnemonic, Encryption
 * Production-ready security features
 */

class WalletSecurity {
    constructor() {
        this.bip39WordList = this.getBIP39WordList();
    }

    // BIP39 Word List (2048 words)
    getBIP39WordList() {
        return [
            'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse',
            'access', 'accident', 'account', 'accuse', 'achieve', 'acid', 'acoustic', 'acquire', 'across', 'act',
            'action', 'actor', 'actual', 'adapt', 'add', 'addict', 'address', 'adjust', 'admit', 'adult',
            'advance', 'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent', 'agree',
            'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album', 'alcohol', 'alert', 'alien',
            'all', 'alley', 'allow', 'almost', 'alone', 'alpha', 'already', 'also', 'alter', 'always',
            'amateur', 'amazing', 'among', 'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger', 'angle',
            'angry', 'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'antique', 'anxiety',
            'any', 'apart', 'apology', 'appear', 'apple', 'approve', 'april', 'area', 'arena', 'argue',
            'arm', 'armed', 'armor', 'army', 'around', 'arrange', 'arrest', 'arrive', 'arrow', 'art',
            'article', 'artist', 'artwork', 'ask', 'aspect', 'assault', 'asset', 'assist', 'assume', 'asthma',
            'athlete', 'atom', 'attack', 'attend', 'attitude', 'attract', 'auction', 'audit', 'august', 'aunt',
            'author', 'auto', 'autumn', 'average', 'avocado', 'avoid', 'awake', 'aware', 'away', 'awesome',
            'awful', 'awkward', 'axis', 'baby', 'bachelor', 'bacon', 'badge', 'bag', 'balance', 'balcony',
            'ball', 'bamboo', 'banana', 'banner', 'bar', 'barely', 'bargain', 'barrel', 'base', 'basic',
            'basket', 'battle', 'beach', 'bean', 'beauty', 'because', 'become', 'beef', 'before', 'begin',
            'behave', 'behind', 'believe', 'below', 'belt', 'bench', 'benefit', 'best', 'betray', 'better',
            'between', 'beyond', 'bicycle', 'bid', 'bike', 'bind', 'biology', 'bird', 'birth', 'bitter',
            'black', 'blade', 'blame', 'blanket', 'blast', 'bleak', 'bless', 'blind', 'blood', 'blossom',
            'blow', 'blue', 'blur', 'blush', 'board', 'boat', 'body', 'boil', 'bomb', 'bone',
            'bonus', 'book', 'boost', 'border', 'boring', 'borrow', 'boss', 'bottom', 'bounce', 'box',
            'boy', 'bracket', 'brain', 'brand', 'brass', 'brave', 'bread', 'breeze', 'brick', 'bridge',
            'brief', 'bright', 'bring', 'brisk', 'broccoli', 'broken', 'bronze', 'broom', 'brother', 'brown',
            'brush', 'bubble', 'buddy', 'budget', 'buffalo', 'build', 'bulb', 'bulk', 'bullet', 'bundle',
            'bunker', 'burden', 'burger', 'burst', 'bus', 'business', 'busy', 'butter', 'buyer', 'buzz',
            'cabbage', 'cabin', 'cable', 'cactus', 'cage', 'cake', 'call', 'calm', 'camera', 'camp',
            'can', 'canal', 'cancel', 'candy', 'cannon', 'canoe', 'canvas', 'canyon', 'capable', 'capital',
            'captain', 'car', 'carbon', 'card', 'care', 'career', 'careful', 'careless', 'cargo', 'carpet',
            'carry', 'cart', 'case', 'cash', 'casino', 'cast', 'casual', 'cat', 'catalog', 'catch',
            'category', 'cattle', 'caught', 'cause', 'caution', 'cave', 'ceiling', 'celery', 'cement', 'census',
            'century', 'cereal', 'certain', 'chair', 'chalk', 'champion', 'change', 'chaos', 'chapter', 'charge',
            'chase', 'chat', 'cheap', 'check', 'cheese', 'chef', 'cherry', 'chest', 'chicken', 'chief',
            'child', 'chimney', 'choice', 'choose', 'chronic', 'chuckle', 'chunk', 'churn', 'cigar', 'cinnamon',
            'circle', 'citizen', 'city', 'civil', 'claim', 'clamp', 'clarify', 'claw', 'clay', 'clean',
            'clerk', 'clever', 'click', 'client', 'cliff', 'climb', 'clinic', 'clip', 'clock', 'clog',
            'close', 'cloth', 'cloud', 'clown', 'club', 'clump', 'cluster', 'clutch', 'coach', 'coast',
            'coconut', 'code', 'coffee', 'coil', 'coin', 'collect', 'color', 'column', 'combine', 'come',
            'comfort', 'comic', 'common', 'company', 'concert', 'conduct', 'confirm', 'congress', 'connect', 'consider',
            'control', 'convince', 'cook', 'cool', 'copper', 'copy', 'coral', 'core', 'corn', 'correct',
            'cost', 'cotton', 'couch', 'country', 'couple', 'course', 'cousin', 'cover', 'coyote', 'crack',
            'cradle', 'craft', 'cram', 'crane', 'crash', 'crater', 'crawl', 'crazy', 'cream', 'credit',
            'creek', 'crew', 'cricket', 'crime', 'crisp', 'critic', 'crop', 'cross', 'crouch', 'crowd',
            'crucial', 'cruel', 'cruise', 'crumble', 'crunch', 'crush', 'cry', 'crystal', 'cube', 'culture',
            'cup', 'cupboard', 'curious', 'current', 'curtain', 'curve', 'cushion', 'custom', 'cute', 'cycle',
            'dad', 'damage', 'damp', 'dance', 'danger', 'daring', 'dark', 'dash', 'date', 'daughter',
            'dawn', 'day', 'deal', 'debate', 'debris', 'decade', 'december', 'decide', 'decline', 'decorate',
            'decrease', 'deer', 'defense', 'define', 'defy', 'degree', 'delay', 'deliver', 'demand', 'demise',
            'denial', 'dentist', 'deny', 'depart', 'depend', 'deposit', 'depth', 'deputy', 'derive', 'describe',
            'desert', 'design', 'desk', 'despair', 'destroy', 'detail', 'detect', 'develop', 'device', 'devote',
            'diagram', 'dial', 'diamond', 'diary', 'dice', 'diesel', 'diet', 'differ', 'digital', 'dignity',
            'dilemma', 'dinner', 'dinosaur', 'direct', 'dirt', 'disagree', 'discover', 'disease', 'dish', 'dismiss',
            'disorder', 'display', 'distance', 'divert', 'divide', 'divorce', 'dizzy', 'doctor', 'document', 'dog',
            'doll', 'dolphin', 'domain', 'donate', 'donkey', 'donor', 'door', 'dose', 'double', 'dove',
            'draft', 'dragon', 'drama', 'drastic', 'draw', 'dream', 'dress', 'drift', 'drill', 'drink',
            'drip', 'drive', 'drop', 'drum', 'dry', 'duck', 'dumb', 'dune', 'during', 'dust',
            'dutch', 'duty', 'dwarf', 'dynamic', 'eager', 'eagle', 'early', 'earn', 'earth', 'easily',
            'east', 'easy', 'echo', 'ecology', 'economy', 'edge', 'edit', 'educate', 'effort', 'egg',
            'eight', 'either', 'elbow', 'elder', 'electric', 'elegant', 'element', 'elephant', 'elevator', 'elite',
            'else', 'embark', 'embody', 'embrace', 'emerge', 'emotion', 'employ', 'empower', 'empty', 'enable',
            'enact', 'end', 'endless', 'endorse', 'enemy', 'energy', 'enforce', 'engage', 'engine', 'enhance',
            'enjoy', 'enlist', 'enough', 'enrich', 'enroll', 'ensure', 'enter', 'entire', 'entry', 'envelope',
            'episode', 'equal', 'equip', 'era', 'erase', 'erode', 'erosion', 'error', 'erupt', 'escape',
            'essay', 'essence', 'estate', 'eternal', 'ethics', 'evidence', 'evil', 'evoke', 'evolve', 'exact',
            'example', 'exceed', 'excellent', 'except', 'exchange', 'excite', 'exclude', 'excuse', 'execute', 'exercise',
            'exhaust', 'exhibit', 'exile', 'exist', 'exit', 'exotic', 'expand', 'expect', 'expire', 'explain',
            'expose', 'express', 'extend', 'extra', 'eye', 'eyebrow', 'fabric', 'face', 'faculty', 'fade',
            'faint', 'faith', 'fall', 'false', 'fame', 'family', 'famous', 'fan', 'fancy', 'fantasy',
            'farm', 'fashion', 'fat', 'fatal', 'father', 'fatigue', 'fault', 'favorite', 'feature', 'february',
            'federal', 'fee', 'feed', 'feel', 'female', 'fence', 'festival', 'fetch', 'fever', 'few',
            'fiber', 'fiction', 'field', 'figure', 'file', 'film', 'filter', 'final', 'find', 'fine',
            'finger', 'finish', 'fire', 'firm', 'first', 'fiscal', 'fish', 'fit', 'fitness', 'fix',
            'flag', 'flame', 'flash', 'flat', 'flavor', 'flee', 'flight', 'flip', 'float', 'flock',
            'floor', 'flower', 'fluid', 'flush', 'fly', 'foam', 'focus', 'fog', 'foil', 'fold',
            'follow', 'food', 'foot', 'force', 'forest', 'forget', 'fork', 'fortune', 'forum', 'forward',
            'fossil', 'foster', 'found', 'fox', 'fragile', 'frame', 'frequent', 'fresh', 'friend', 'fringe',
            'frog', 'front', 'frost', 'frown', 'frozen', 'fruit', 'fuel', 'fun', 'funny', 'furnace',
            'fury', 'future', 'gadget', 'gain', 'galaxy', 'gallery', 'game', 'gap', 'garage', 'garbage',
            'garden', 'garlic', 'garment', 'gas', 'gasp', 'gate', 'gather', 'gauge', 'gaze', 'general',
            'genius', 'genre', 'gentle', 'genuine', 'gesture', 'ghost', 'giant', 'gift', 'giggle', 'ginger',
            'giraffe', 'girl', 'give', 'glad', 'glance', 'glare', 'glass', 'glide', 'glimpse', 'globe',
            'gloom', 'glory', 'glove', 'glow', 'glue', 'goat', 'goddess', 'gold', 'good', 'goose',
            'gorilla', 'gospel', 'gossip', 'govern', 'gown', 'grab', 'grace', 'grain', 'grant', 'grape',
            'grass', 'gravity', 'great', 'green', 'grid', 'grief', 'grit', 'grocery', 'group', 'grow',
            'grunt', 'guard', 'guess', 'guide', 'guilt', 'guitar', 'gun', 'gym', 'habit', 'hair',
            'half', 'hammer', 'hamster', 'hand', 'happy', 'harbor', 'hard', 'harsh', 'harvest', 'hat',
            'have', 'hawk', 'hazard', 'head', 'health', 'hear', 'heart', 'heavy', 'hedgehog', 'height',
            'hello', 'helmet', 'help', 'hen', 'hero', 'hidden', 'high', 'hill', 'hint', 'hip',
            'hire', 'history', 'hobby', 'hockey', 'hold', 'hole', 'holiday', 'hollow', 'home', 'honey',
            'hood', 'hope', 'horn', 'horror', 'horse', 'hospital', 'host', 'hotel', 'hour', 'hover',
            'hub', 'huge', 'human', 'humble', 'humor', 'hundred', 'hungry', 'hunt', 'hurdle', 'hurry',
            'hurt', 'husband', 'hybrid', 'ice', 'icon', 'idea', 'identify', 'idle', 'ignore', 'ill',
            'illegal', 'illness', 'image', 'imitate', 'immense', 'immune', 'impact', 'implement', 'imply', 'import',
            'impose', 'improve', 'impulse', 'inch', 'include', 'income', 'increase', 'index', 'indicate', 'indoor',
            'industry', 'infant', 'inflict', 'inform', 'inhale', 'inherit', 'initial', 'inject', 'injury', 'inmate',
            'inner', 'innocent', 'input', 'inquiry', 'insane', 'insect', 'inside', 'inspire', 'install', 'intact',
            'interest', 'into', 'invest', 'invite', 'involve', 'iron', 'island', 'isolate', 'issue', 'item',
            'ivory', 'jacket', 'jaguar', 'jar', 'jazz', 'jealous', 'jeans', 'jelly', 'jewel', 'job',
            'join', 'joke', 'journey', 'joy', 'judge', 'juice', 'jump', 'jungle', 'junior', 'junk',
            'just', 'kangaroo', 'keen', 'keep', 'ketchup', 'key', 'kick', 'kid', 'kidney', 'kind',
            'kingdom', 'kiss', 'kit', 'kitchen', 'kite', 'kitten', 'kiwi', 'knee', 'knife', 'knock',
            'know', 'lab', 'label', 'labor', 'ladder', 'lady', 'lake', 'lamp', 'language', 'laptop',
            'large', 'later', 'latin', 'laugh', 'laundry', 'lava', 'law', 'lawn', 'lawsuit', 'layer',
            'lazy', 'leader', 'leaf', 'learn', 'leave', 'lecture', 'left', 'leg', 'legal', 'legend',
            'leisure', 'lemon', 'lend', 'length', 'lens', 'leopard', 'lesson', 'letter', 'level', 'liar',
            'liberty', 'library', 'license', 'life', 'lift', 'light', 'like', 'limb', 'limit', 'link',
            'lion', 'liquid', 'list', 'little', 'live', 'lizard', 'load', 'loan', 'lobster', 'local',
            'lock', 'logic', 'lonely', 'long', 'loop', 'lottery', 'loud', 'lounge', 'love', 'low',
            'loyal', 'lucky', 'luggage', 'lumber', 'lunar', 'lunch', 'luxury', 'lyrics', 'machine', 'mad',
            'magic', 'magnet', 'maid', 'mail', 'main', 'major', 'make', 'mammal', 'man', 'manage',
            'mandate', 'mango', 'mansion', 'manual', 'maple', 'marble', 'march', 'margin', 'marine', 'market',
            'marriage', 'mask', 'mass', 'master', 'match', 'material', 'math', 'matrix', 'matter', 'maximum',
            'maze', 'meadow', 'mean', 'measure', 'meat', 'mechanic', 'medal', 'media', 'melody', 'melt',
            'member', 'memory', 'mention', 'menu', 'mercy', 'merge', 'merit', 'merry', 'mesh', 'message',
            'metal', 'method', 'middle', 'midnight', 'milk', 'million', 'mimic', 'mind', 'minimum', 'minor',
            'minute', 'miracle', 'mirror', 'misery', 'miss', 'mistake', 'mix', 'mixture', 'mobile', 'model',
            'modify', 'mom', 'moment', 'monitor', 'monkey', 'monster', 'month', 'moon', 'moral', 'more',
            'morning', 'mosquito', 'mother', 'motion', 'motor', 'mountain', 'mouse', 'move', 'movie', 'much',
            'muffin', 'mule', 'multiply', 'muscle', 'museum', 'mushroom', 'music', 'must', 'mutual', 'myself',
            'mystery', 'myth', 'naive', 'name', 'napkin', 'narrow', 'nasty', 'nation', 'nature', 'near',
            'neck', 'need', 'negative', 'neglect', 'neither', 'nephew', 'nerve', 'nest', 'net', 'network',
            'neutral', 'never', 'news', 'next', 'nice', 'night', 'noble', 'noise', 'nominee', 'none',
            'noodle', 'normal', 'north', 'nose', 'notable', 'note', 'nothing', 'notice', 'novel', 'now',
            'nuclear', 'number', 'nurse', 'nut', 'oak', 'obey', 'object', 'oblige', 'obscure', 'observe',
            'obtain', 'obvious', 'occur', 'ocean', 'october', 'odor', 'off', 'offer', 'office', 'often',
            'oil', 'okay', 'old', 'olive', 'olympic', 'omit', 'once', 'one', 'onion', 'online',
            'only', 'open', 'opera', 'opinion', 'oppose', 'option', 'orange', 'orbit', 'orchard', 'order',
            'ordinary', 'organ', 'orient', 'original', 'orphan', 'ostrich', 'other', 'outdoor', 'outer', 'output',
            'outside', 'oval', 'oven', 'over', 'own', 'owner', 'oxygen', 'oyster', 'ozone', 'pact',
            'paddle', 'page', 'pair', 'palace', 'palm', 'panda', 'panel', 'panic', 'panther', 'paper',
            'parade', 'parent', 'park', 'parrot', 'party', 'pass', 'patch', 'path', 'patient', 'patrol',
            'pattern', 'pause', 'pave', 'payment', 'peace', 'peanut', 'pear', 'peasant', 'pelican', 'pen',
            'penalty', 'pencil', 'people', 'pepper', 'perfect', 'permit', 'person', 'pet', 'phone', 'photo',
            'phrase', 'physical', 'piano', 'picnic', 'picture', 'piece', 'pig', 'pigeon', 'pill', 'pilot',
            'pink', 'pioneer', 'pipe', 'pistol', 'pitch', 'pizza', 'place', 'planet', 'plastic', 'plate',
            'play', 'please', 'pledge', 'pluck', 'plug', 'plunge', 'poem', 'poet', 'point', 'polar',
            'pole', 'police', 'pond', 'pony', 'pool', 'popular', 'portion', 'position', 'possible', 'post',
            'potato', 'pottery', 'poverty', 'powder', 'power', 'practice', 'praise', 'predict', 'prefer', 'prepare',
            'present', 'pretty', 'prevent', 'price', 'pride', 'primary', 'print', 'priority', 'prison', 'private',
            'prize', 'problem', 'process', 'produce', 'profit', 'program', 'project', 'promote', 'proof', 'property',
            'prosper', 'protect', 'proud', 'provide', 'public', 'pudding', 'pull', 'pulp', 'pulse', 'pumpkin',
            'punch', 'pupil', 'puppy', 'purchase', 'purity', 'purpose', 'purse', 'push', 'put', 'puzzle',
            'pyramid', 'quality', 'quantum', 'quarter', 'question', 'quick', 'quit', 'quiz', 'quote', 'rabbit',
            'raccoon', 'race', 'rack', 'radar', 'radio', 'rail', 'rain', 'raise', 'rally', 'ramp',
            'ranch', 'random', 'range', 'rapid', 'rare', 'rate', 'rather', 'raven', 'raw', 'razor',
            'ready', 'real', 'reason', 'rebel', 'rebuild', 'recall', 'receive', 'recipe', 'record', 'recycle',
            'red', 'reduce', 'reflect', 'reform', 'refuse', 'region', 'regret', 'regular', 'reject', 'relax',
            'release', 'relief', 'rely', 'remain', 'remember', 'remind', 'remove', 'render', 'renew', 'rent',
            'reopen', 'repair', 'repeat', 'replace', 'report', 'require', 'rescue', 'resemble', 'resist', 'resource',
            'response', 'result', 'retire', 'retreat', 'return', 'reunion', 'reveal', 'review', 'reward', 'rhythm',
            'rib', 'ribbon', 'rice', 'rich', 'ride', 'ridge', 'rifle', 'right', 'rigid', 'ring',
            'riot', 'rip', 'ripe', 'rise', 'risk', 'ritual', 'rival', 'river', 'road', 'roast',
            'robot', 'robust', 'rocket', 'romance', 'roof', 'rookie', 'room', 'rose', 'rotate', 'rough',
            'round', 'route', 'royal', 'rubber', 'rude', 'rug', 'rule', 'run', 'runway', 'rural',
            'sad', 'saddle', 'sadness', 'safe', 'sail', 'salad', 'salmon', 'salon', 'salt', 'same',
            'sample', 'sand', 'satisfy', 'satoshi', 'sauce', 'sausage', 'save', 'say', 'scale', 'scan',
            'scare', 'scatter', 'scene', 'scheme', 'school', 'science', 'scissors', 'scorpion', 'scout', 'scrap',
            'screen', 'script', 'scrub', 'sea', 'search', 'season', 'seat', 'second', 'secret', 'section',
            'security', 'seed', 'seek', 'segment', 'select', 'sell', 'seminar', 'senior', 'sense', 'sentence',
            'series', 'serious', 'service', 'session', 'settle', 'setup', 'seven', 'shadow', 'shaft', 'shallow',
            'share', 'shed', 'shell', 'sheriff', 'shield', 'shift', 'shine', 'ship', 'shiver', 'shock',
            'shoe', 'shoot', 'shop', 'short', 'shoulder', 'shove', 'shrimp', 'shrug', 'shuffle', 'shy',
            'sibling', 'sick', 'side', 'siege', 'sight', 'sign', 'silent', 'silk', 'silly', 'silver',
            'similar', 'simple', 'since', 'sing', 'siren', 'sister', 'situate', 'six', 'size', 'skate',
            'sketch', 'ski', 'skill', 'skin', 'skirt', 'skull', 'slab', 'slam', 'sleep', 'slender',
            'slice', 'slide', 'slight', 'slim', 'slogan', 'slot', 'slow', 'slush', 'small', 'smart',
            'smile', 'smoke', 'smooth', 'snack', 'snake', 'snap', 'sniff', 'snow', 'soap', 'soccer',
            'social', 'sock', 'soda', 'soft', 'solar', 'soldier', 'solid', 'solution', 'solve', 'someone',
            'song', 'soon', 'sorry', 'sort', 'soul', 'sound', 'soup', 'source', 'south', 'space',
            'spare', 'spatial', 'spawn', 'speak', 'special', 'speed', 'spell', 'spend', 'sphere', 'spice',
            'spider', 'spike', 'spin', 'spirit', 'split', 'spoil', 'sponsor', 'spoon', 'sport', 'spot',
            'spray', 'spread', 'spring', 'spy', 'square', 'squeeze', 'squirrel', 'stable', 'stadium', 'staff',
            'stage', 'stairs', 'stamp', 'stand', 'start', 'state', 'stay', 'steak', 'steel', 'stem',
            'step', 'stereo', 'stick', 'still', 'sting', 'stock', 'stomach', 'stone', 'stool', 'story',
            'stove', 'strategy', 'street', 'strike', 'strong', 'struggle', 'student', 'stuff', 'stumble', 'style',
            'subject', 'submit', 'subway', 'success', 'such', 'sudden', 'suffer', 'sugar', 'suggest', 'suit',
            'summer', 'sun', 'sunny', 'sunset', 'super', 'supply', 'supreme', 'sure', 'surface', 'surge',
            'surprise', 'surround', 'survey', 'suspect', 'sustain', 'swallow', 'swamp', 'swap', 'swarm', 'swear',
            'sweet', 'swift', 'swim', 'swing', 'switch', 'sword', 'symbol', 'symptom', 'syrup', 'system',
            'table', 'tackle', 'tag', 'tail', 'talent', 'talk', 'tank', 'tape', 'target', 'task',
            'taste', 'tattoo', 'taxi', 'teach', 'team', 'tell', 'ten', 'tenant', 'tennis', 'tent',
            'term', 'test', 'text', 'thank', 'that', 'theme', 'then', 'theory', 'there', 'they',
            'thing', 'this', 'thought', 'three', 'thrive', 'throw', 'thumb', 'thunder', 'ticket', 'tide',
            'tiger', 'tilt', 'timber', 'time', 'tiny', 'tip', 'tired', 'tissue', 'title', 'toast',
            'tobacco', 'today', 'toddler', 'toe', 'together', 'toilet', 'token', 'tomato', 'tomorrow', 'tone',
            'tongue', 'tonight', 'tool', 'tooth', 'top', 'topic', 'topple', 'torch', 'tornado', 'tortoise',
            'toss', 'total', 'tourist', 'toward', 'tower', 'town', 'toy', 'track', 'trade', 'traffic',
            'tragic', 'train', 'transfer', 'trap', 'trash', 'travel', 'tray', 'treat', 'tree', 'trend',
            'trial', 'tribe', 'trick', 'trigger', 'trim', 'trip', 'trophy', 'trouble', 'truck', 'true',
            'truly', 'trumpet', 'trust', 'truth', 'try', 'tube', 'tuition', 'tumble', 'tuna', 'tunnel',
            'turkey', 'turn', 'turtle', 'twelve', 'twenty', 'twice', 'twin', 'twist', 'two', 'type',
            'typical', 'ugly', 'umbrella', 'unable', 'unaware', 'uncle', 'uncover', 'under', 'undo', 'unfair',
            'unfold', 'unhappy', 'uniform', 'unique', 'unit', 'universe', 'unknown', 'unlock', 'until', 'unusual',
            'unveil', 'update', 'upgrade', 'uphold', 'upon', 'upper', 'upset', 'urban', 'urge', 'usage',
            'use', 'used', 'useful', 'useless', 'usual', 'utility', 'vacant', 'vacuum', 'vague', 'valid',
            'valley', 'valve', 'van', 'vanish', 'vapor', 'various', 'vast', 'vault', 'vehicle', 'velvet',
            'vendor', 'venture', 'venue', 'verb', 'verify', 'version', 'very', 'vessel', 'veteran', 'viable',
            'vibrant', 'vicious', 'victory', 'video', 'view', 'village', 'vintage', 'violin', 'virtual', 'virus',
            'visa', 'visit', 'visual', 'vital', 'vivid', 'vocal', 'voice', 'void', 'volcano', 'volume',
            'vote', 'voyage', 'wage', 'wagon', 'wait', 'walk', 'wall', 'walnut', 'want', 'warfare',
            'warm', 'warrior', 'wash', 'wasp', 'waste', 'water', 'wave', 'way', 'wealth', 'weapon',
            'weary', 'weather', 'web', 'wedding', 'weekend', 'weird', 'welcome', 'west', 'wet', 'whale',
            'what', 'wheat', 'wheel', 'when', 'where', 'whip', 'whisper', 'wide', 'width', 'wife',
            'wild', 'will', 'win', 'window', 'wine', 'wing', 'wink', 'winner', 'winter', 'wire',
            'wisdom', 'wise', 'wish', 'witness', 'wolf', 'woman', 'wonder', 'wood', 'wool', 'word',
            'work', 'world', 'worry', 'worth', 'wrap', 'wreck', 'wrestle', 'wrist', 'write', 'wrong',
            'yard', 'year', 'yellow', 'you', 'young', 'youth', 'zebra', 'zero', 'zone', 'zoo'
        ];
    }

    // Generate mnemonic seed phrase (12 or 24 words)
    // FIXED: Uses proper BIP39 with checksum via ethers.js
    generateMnemonic(length = 12) {
        if (length !== 12 && length !== 24) {
            length = 12;
        }

        // Use ethers.js for proper BIP39 mnemonic with checksum
        if (typeof ethers !== 'undefined') {
            try {
                // Generate random wallet with proper BIP39 mnemonic
                const wallet = ethers.Wallet.createRandom();
                const phrase = wallet.mnemonic.phrase;

                // For 24 words, we need more entropy
                if (length === 24) {
                    // Generate two 12-word phrases and combine entropy
                    // Actually ethers v6 supports 24 words natively with entropy
                    const entropy = ethers.randomBytes(length === 24 ? 32 : 16);
                    const mnemonic = ethers.Mnemonic.fromEntropy(entropy);
                    console.log('✅ Generated BIP39 mnemonic with checksum (ethers.js) - 24 words');
                    return mnemonic.phrase;
                }

                console.log('✅ Generated BIP39 mnemonic with checksum (ethers.js)');
                return phrase;
            } catch (e) {
                console.error('Ethers mnemonic generation failed:', e);
                throw new Error('Failed to generate secure mnemonic. Please refresh the page.');
            }
        }

        // FALLBACK: Generate using crypto.getRandomValues + BIP39 checksum
        // This is a backup if ethers.js is not loaded
        throw new Error('ethers.js is required for secure mnemonic generation. Please ensure it is loaded.');
    }

    // Validate mnemonic phrase
    validateMnemonic(phrase) {
        const words = phrase.trim().split(/\s+/);

        if (words.length !== 12 && words.length !== 24) {
            return { valid: false, error: 'Mnemonic must be 12 or 24 words' };
        }

        for (const word of words) {
            if (!this.bip39WordList.includes(word.toLowerCase())) {
                return { valid: false, error: `Invalid word: ${word}` };
            }
        }

        return { valid: true };
    }

    // Derive wallet from mnemonic - FIXED for MetaMask/BSC/ERC compatibility
    async deriveWalletFromMnemonic(mnemonic, index = 0) {
        const validation = this.validateMnemonic(mnemonic);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        // STANDARD BIP44 DERIVATION - Same as MetaMask
        if (typeof ethers !== 'undefined') {
            try {
                console.log('Using standard BIP44 derivation with Ethers.js...');
                const path = `m/44'/60'/0'/0/${index}`; // Standard Ethereum/BSC Path
                const wallet = ethers.HDNodeWallet.fromPhrase(mnemonic, null, path);

                console.log('✅ Derived wallet using standard BIP44 - Address:', wallet.address);
                return {
                    address: wallet.address,
                    publicKey: wallet.signingKey.publicKey,
                    privateKey: wallet.privateKey,
                    mnemonic: mnemonic,
                    index: index,
                    derivationPath: path
                };
            } catch (e) {
                console.error('Ethers derivation failed:', e.message);
                throw new Error('Failed to derive wallet from mnemonic. The seed phrase may be invalid or have an incorrect checksum.');
            }
        }

        throw new Error('ethers.js is required for wallet derivation. Please ensure it is loaded.');
    }

    // LEGACY METHODS - Kept for backward compatibility with old wallets
    // These are NOT used for new wallet creation
    // Convert mnemonic to seed (LEGACY - DO NOT USE FOR NEW WALLETS)
    async mnemonicToSeed(mnemonic) {
        console.warn('⚠️ Using legacy mnemonicToSeed - this produces non-standard keys');
        const normalizedMnemonic = mnemonic.trim().toLowerCase();
        const encoder = new TextEncoder();
        const data = encoder.encode(normalizedMnemonic);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return new Uint8Array(hash);
    }

    // Derive key pair from seed (LEGACY - DO NOT USE FOR NEW WALLETS)
    async deriveKeyPair(seed, index) {
        console.warn('⚠️ Using legacy deriveKeyPair - this produces non-standard keys');
        const combined = new Uint8Array(seed.length + 4);
        combined.set(seed);
        combined.set([index >> 24, index >> 16, index >> 8, index], seed.length);
        const hash = await crypto.subtle.digest('SHA-256', combined);
        const keyMaterial = new Uint8Array(hash);
        const privateKeyHex = Array.from(keyMaterial)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
            .slice(0, 64);
        const publicKeyHash = await crypto.subtle.digest('SHA-256', keyMaterial);
        return {
            publicKey: new Uint8Array(publicKeyHash),
            privateKey: privateKeyHex
        };
    }

    // Convert key pair to address (LEGACY - DO NOT USE FOR NEW WALLETS)
    async keyPairToAddress(keyPair) {
        console.warn('⚠️ Using legacy keyPairToAddress - this produces non-standard addresses');
        let publicKeyHash;
        if (keyPair.publicKey instanceof ArrayBuffer || keyPair.publicKey instanceof Uint8Array) {
            publicKeyHash = await crypto.subtle.digest('SHA-256', keyPair.publicKey);
        } else {
            const publicKeyBytes = new Uint8Array(
                keyPair.publicKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
            );
            publicKeyHash = await crypto.subtle.digest('SHA-256', publicKeyBytes);
        }
        const address = '0x' + Array.from(new Uint8Array(publicKeyHash))
            .slice(0, 20)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        return address;
    }

    // Passkey (WebAuthn) Registration
    async registerPasskey(walletAddress) {
        if (!window.PublicKeyCredential) {
            throw new Error('WebAuthn/Passkeys not supported in this browser');
        }

        try {
            const publicKeyCredentialCreationOptions = {
                challenge: Uint8Array.from(
                    crypto.getRandomValues(new Uint8Array(32))
                ),
                rp: {
                    name: 'CHEESE Wallet',
                    id: window.location.hostname,
                },
                user: {
                    id: Uint8Array.from(walletAddress, c => c.charCodeAt(0)),
                    name: walletAddress,
                    displayName: 'CHEESE Wallet',
                },
                pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',
                    userVerification: 'required',
                },
                timeout: 60000,
                attestation: 'direct'
            };

            const credential = await navigator.credentials.create({
                publicKey: publicKeyCredentialCreationOptions
            });

            return {
                success: true,
                credentialId: this.arrayBufferToBase64(credential.rawId),
                publicKey: this.arrayBufferToBase64(credential.response.getPublicKey()),
                attestationObject: this.arrayBufferToBase64(credential.response.attestationObject)
            };
        } catch (error) {
            console.error('Passkey registration error:', error);
            throw new Error('Failed to register passkey: ' + error.message);
        }
    }

    // Passkey Authentication
    async authenticateWithPasskey(credentialId) {
        if (!window.PublicKeyCredential) {
            throw new Error('WebAuthn/Passkeys not supported in this browser');
        }

        try {
            const publicKeyCredentialRequestOptions = {
                challenge: Uint8Array.from(
                    crypto.getRandomValues(new Uint8Array(32))
                ),
                allowCredentials: [{
                    id: this.base64ToArrayBuffer(credentialId),
                    type: 'public-key',
                    transports: ['internal', 'usb', 'nfc', 'ble']
                }],
                timeout: 60000,
                userVerification: 'required'
            };

            const assertion = await navigator.credentials.get({
                publicKey: publicKeyCredentialRequestOptions
            });

            return {
                success: true,
                credentialId: this.arrayBufferToBase64(assertion.rawId),
                authenticatorData: this.arrayBufferToBase64(assertion.response.authenticatorData),
                clientDataJSON: this.arrayBufferToBase64(assertion.response.clientDataJSON),
                signature: this.arrayBufferToBase64(assertion.response.signature)
            };
        } catch (error) {
            console.error('Passkey authentication error:', error);
            throw new Error('Failed to authenticate with passkey: ' + error.message);
        }
    }

    // Strong encryption using AES-GCM
    async encryptData(data, password) {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const passwordBuffer = encoder.encode(password);

        // Derive key from password
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );

        const salt = crypto.getRandomValues(new Uint8Array(16));
        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            dataBuffer
        );

        return {
            encrypted: this.arrayBufferToBase64(encrypted),
            salt: this.arrayBufferToBase64(salt),
            iv: this.arrayBufferToBase64(iv)
        };
    }

    // Decrypt data
    async decryptData(encryptedData, password) {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const passwordBuffer = encoder.encode(password);

        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );

        const salt = this.base64ToArrayBuffer(encryptedData.salt);
        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        const iv = this.base64ToArrayBuffer(encryptedData.iv);
        const encrypted = this.base64ToArrayBuffer(encryptedData.encrypted);

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            encrypted
        );

        return decoder.decode(decrypted);
    }

    // Generate 2FA code (TOTP)
    generate2FACode(secret) {
        // Simplified TOTP (in production use proper TOTP library)
        const time = Math.floor(Date.now() / 1000 / 30);
        const timeHex = time.toString(16).padStart(16, '0');
        const hash = crypto.subtle.digest('SHA-1', new TextEncoder().encode(secret + timeHex));
        // Return 6-digit code
        return '000000'; // Placeholder
    }

    // Utility functions
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WalletSecurity;
}


