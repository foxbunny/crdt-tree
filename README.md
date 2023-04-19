# CRDT tree implementation

This module contains a JavaScript implementation of a tree-like structure that
is based around the operation-based CRDT concepts to facilitate collaboration on
distributed tree data. It was specifically designed for use in a p2p
offline-capable PWA that operates on a tree structure, and was extracted as a
stand-alone module.

CRDT stands for conflict-free replicated data types. This is a set of data types
and associated algorithms that allows distributed replicas of some data to
synchronize and eventually achieve consistency among themselves without
requiring complicated synchronization and ordering mechanisms found in other
consistency models. 

This module implements a specific version of CRDT known as operation-based CRDT.
This choice was made due to the need to support both real-time and one-off
synchronization.

Although this approach was specifically chosen to address the need to enable
offline and collaborative use of the data in a p2p fashion, it should be noted
that consistency achieved by using this implementation is eventual, and not
instantaneous. Until peers have had a chance to exchange the updates and
synchronize with each other the data diverges between them. CRDT merely ensures
that divergent data has a chance of converging at a later date.

## Concepts

### Replicas

The data that the CRDT tree operates on is expected to be replicated across
different users on a p2p network. Individual instances of the data are called
'replicas'. When we say 'global data', we mean the totality of all data across 
all replicas. We refer to the data within the single replica as 'local data', 
and the data from another replica as 'remote data'.

In this document, we use the term 'replica' to mean both local data, as well as
the peer system on the network.

### Operations

All modifications on the local data are performed through operations. The ensure
eventual consistency, the operations on the tree are limited to the following:

- `setValue(tree, nodeId, key, value)`
- `insert(tree, parentId, refId, nodeData)`
- `move(tree, nodeId, parentId, refId)`
- `remove(tree, nodeId)`

More complex operations must use the specified operations as their basis rather
than directly manipulating the tree data.

The module internally implements the matching methods that allow it to replay
operations from remote replicas on the local data with automatic
conflict resolution (see the next section).

### Merge

Replicas are free to diverge from each other at any given time. While online,
they may exchange information to reduce the divergence in the process called
'merging'. Each replica keeps track of the operations performed on the local 
data. In presence of other replicas, replicas will transmit the operations to
them and receive operations from them. Operations on the remote data are 
'merged', or replayed, on the local data making them more consistent.

The merges are performed using algorithms specifically designed to have the
following characteristics:

- An operation can always be applied to the local data
- Operation can be applied in any order an will always have the same end result
- An operation can be applied multiple times without changing its effect

In order to achieve this, both the data and the associated algorithms are
designed so that any conflicts can be resolved automatically by the replica
performing the mere so that the resulting local data is predictably consistent
with the remote data.

This module implements the insert, move, and remove operations to satisfy those 
criteria. This means that replicas accidentally receiving outdated operations,
or receiving operations in a different order than how they were originally
performed, will still be able to achieve consistency with another replica where
the operations were applied in a different order. It also allows one replica to
receive a sequence of operations from two or more replicas in any order, even
with duplicates.

Automatic conflict resolution is the key feature of the CRDTs. This allows
the replicas to synchronize with each other without a lot of overhead, and
ensures that they may safely diverge if needed. This section describes the 
strategies used for conflict resolution in this concrete implementation.

#### Insert vs insert

With concurrent inserts, the only possible conflict is an insertion of nodes 
at the same general position within a child list. CRDT tree deals with this 
possibility using virtual positions to describe the position of a node 
within a child list, as opposed to using array indices or references to 
other nodes in the list.

When a node is inserted under a parent node, it is given a new virtual position.
If this happens at the same relative position with the same child list, the
nodes in different replicas will normally receive slightly (randomly) different
virtual positions, but still at the same relative position compared to other
nodes in the same child list. Although the relative order of the two
newly-inserted nodes will be random, they will still be inserted in "about" the
same location with the child list without causing conflicts. In an unlikely, but
still possible, case where the two nodes receive the exact same virtual
position, the timestamp will play a role of a tie-breaker. A node that was
created later will be placed after the node that was created earlier.

#### Move vs move

There are two possible conflicts when moving nodes. The same node could be 
moved concurrently in two or more replicas. Different nodes could be moved 
to the same relative location within the same child list.

To resolve the situation where the same nodes is moved to different 
locations, the LWW (last write wins) strategy is used. Whenever a node is 
moved, a timestamp of the move is recorded. A move with the highest (latest) 
timestamp will take precedence over other moves.

When moving multiple nodes to the same relative location within the same 
child list, the same rules are used as with inserts (see "Insert vs insert").

#### Remove vs remove

Concurrent removals have no conflicts.

#### Insert vs remove

Because removals cannot address nodes that have not yet been inserted, it is 
not possible to perform conflicting insertions and removals concurrently. 
However, it is possible to merge insertions and subsequent removals of the 
same node in reverse order.

When a removal of a previously inserted node is merged in reverse order 
(removal is merged after the insertion), the removal refers to a 
not-yet-present node. This CRDT tree implementation will detect such 
inconsistencies and will internally reorder the operations by placing the 
removal operation in a queue and merging it when it sees the insertion later.

#### Insert vs move

Similarly to the insertion vs removal conflict previously discussed, because
moving cannot be performed on nodes that have not yet been inserted, it is not
possible to perform a conflicting insertions and moves concurrently. Also, 
similarly, it is still possible to merge these operations in reverse order.

Just like with removal of inserted nodes, moving an inserted node will be 
internally reordered by the CRDT tree by using a queue. When an insert is 
received later, any queued move operations will be merged after the 
insertion is merged.

#### Move vs remove

When performing a move concurrently with removal, a conflict can occur when 
the two operations target the same node within different replicas.

To address the concurrent move and removal of the same node, the removals do 
not physically remove nodes from the tree. Instead, a node is converted into 
a so-called 'tombstone': it is merely marked as removed. The marker is also a
removal timestamp. Because of this, it is possible to move a tombstone the same
way any 'live' nodes are moved. During conflict resolution, a timestamp of 
the two operations is compared, and if the removal timestamp is newer than 
the move timestamp, the node remains removed. Conversely, if the removal 
timestamp is older than the move timestamp, the node is restored.

#### Setting values

Value setting is a separate category of operations that do not conflict with 
any of the node management operations mentioned thus far. Setting the value 
of the same key on the same node is the only conflict that is encountered 
when setting values.

To resolve a value conflict, we use the LWW strategy. Each value is stored 
along with the timestamp of last update. When two conflicting updates are 
made on the same value, the update with the higher (later) timestamp wins.

### Operation order

With automatic conflict-resolution as implemented here, we also get the ability 
to merge operations in different order to which they physically happened. 
This is achieved through the use of timestamps. Each operation is recorded 
with a timestamp, and then conflicting operations are always resolved in the 
favor of the later operation. 

Note however that the timestamp, while generated based on the system clock, 
does not need to be accurate. It is merely used for conflict-resolution so 
that *one of the* operations would predictably take precedence, and is 
otherwise treated as any numeric value (in fact, any value where total order 
can be established). This means that phrases like "later" or "earlier" 
refers only to the strictly numeric order of the timestamps, and not 
necessarily the temporal relationship between the operations. The goal of 
this implementation is not to accurately determine the chain of events in 
the system, but to provide consistency between replicas. Therefore, it does not 
matter whether the system clock in one replica is synchronized with the system 
clock of another replica.

## Objects in the tree

The CRDT tree implemented in this module operates on a tree-like structure with
the following types of objects.

### Nodes

Each node in a tree is an object that, at minimum, has the following properties:

```javascript
let node = {
  id: crypto.randomUUID(), // identifier unique across all replicas
  parentId: crypto.randomUUID(), // parent node identifier
  t: Date.now(), // timestamp
  vPos: undefined, // virtual position, a number n where 0 < n < 1
  removed: undefined, // removal timestamp
  data: {}, // application-specific value data in timestamped value format
}
```

The identifier, `id`, is used to uniquely identify every node across all
replicas. Because it is (usually) a randomly generated string, there is no way
to guarantee uniqueness. However, UUIDs are designed for a high level of
uniqueness and should be adequate for more use cases.

The timestamp, `t`, is assigned to a node by a replica when it is first created,
and it is subsequently updated every time it is operated on. Timestamps are used
as one of the conflict-resolution mechanism when conflicting edits are
performed. For instance, when two replicas create a node at the same position
within a child list, or when two replicas move different nodes to the same
position within a child list, the timestamp is used as a tie-breaker to order
the two nodes in a consistent and predictable way by pushing the later-added
node to a later position within the list. Timestamps are also used to determine
the precedence of the operations. For example, if a node is moved and deleted at
the same time, the deleted node may be restored if the move happened later.

The virtual position, `vPos`, is used to determine the relative position of the
node within a child list. Because nodes in the child list may be moved or
inserted concurrently, it is not possible to rely on list indices or identifiers
of the surrounding nodes to specify the intended position of the node. In this
implementation, we instead use a virtual position, a number between 0 and 1 that
represents the relative position of the node within the child list. The 0
represents the start of the list, and the 1 represents the end of the list, and
these numbers are never assigned to the actual nodes.

When nodes are inserted into child lists, they are given a virtual position that
is "somewhere" between the virtual positions of the adjacent nodes. When nodes
are being placed at the very ends of the child list, and there is only one
adjacent node, the numbers 0 and 1 mentioned before play the role of the virtual
position of the other node, and those values are thus reserved for this purpose.

The virtual position numbers are randomly jittered by a small factor to reduce
the chances of a conflict, and are also biased towards the start of the range by
a factor of 0.4. The bias is there to leave a larger range of values towards the
tail end of the list as the likelihood of elements being added to the tail is
generally higher than insertion at the head. The value of 0.4 was chosen
arbitrarily and may be adjusted or made adjustable in future once we have some
real life data about its impact.

The removal flag, `removed`, marks the node as deleted. This is a so-called
'tombstone' node and makes deletion both idempotent and commutative with other
operations. The flag is actually a timestamp. Its absence signifies that the
node is 'live'. Because the removed nodes are still in the data, they have a
tendency of accumulate over time. To free the storage space, they need to be
cleaned up from time to time.

The data object, `data`, is a map between keys and timestamped values. The 
values are arbitrary application-specific values. 

### Timestamped values

Timestamped values are objects in the following format:

```javascript
let tValue = {
  value: 'some JavaScript value',
  t: Date.now(),
}
```

The `value` key points to an arbitrary application-specific JavaScript value.
The value itself has no significance for the CRDT tree implementation.

The `t` key points to a unix timestamp of the value. This timestamp is used to
give precedence to a later update, thus implementing the LWW (last write wins)
strategy for value updates. Whenever an operation sets the value, the value's
timestamp is first compared, and if the value's timestamp is higher than the
timestamp of the operation, the operation is simply ignored. While this does
result in data loss (some operations are not applied at all), it keeps the data
consistent between replicas, which is the primary goal of this module.

## Usage guide

### Installation

CRDT tree can either be used server-side or client-side. It is implemented 
as an ES6 module (without the CommonJS fallback). On the server, the module 
is imported as usual:

```javascript
import * as crdtTree from './crdt-tree'
```

On the client-side, it is added to the document using a module script tag:

```html
<script type="module" src="crdt-tree.js"></script>
```

It is then imported into your application module like so:

```javascript
import * as crdtTree from 'crdt-tree.js'
```

The module is organized into separate functions, and each exported function 
will take the tree as its first argument. This argument should be an 
instance of the CRDT tree created using the `createTree()` function.

### `createTree(nodes, [options])`

To instantiate a new CRDT tree we call the `createTree()` function.

Parameters:

- `nodes` - an array of node objects as described above
- `options` - an object containing any of the following properties:
  - `getTime()` - a function that returns a value that is used as the timestamp.
    The value itself can be anything as long as all replicas use the same type
    of value, and as long as total order can be established between any two of
    such values. In other words, given values x and y returned by
    `getTime()`, one of the following must hold true: `x < y`, `x > y`, or
    `x == y`. Each consecutive value returned by `getTime()` should be higher
    than the previous one, and it should ideally minimize the possibility of two
    replicas generating the same value within a short time span.
    Default: `Date.now`.
  - `operations` - an object that is used to store operations that should be 
    transmitted to other replicas for merging. The object should implement 
    the `Operations` interface described below.
  - `queue` - an object that is used to store a mapping between node ids and a
    list of operations that address the node id. This object should implement
    `Queue` interface described below.

Return value:

An object representing the tree. The properties on the tree are considered an
implementation detail.

Examples:

```javascript
let tree = createTree(nodes, options)
```

Notes:

The tree structure is reconstructed by this function on initialization based on 
the nodes' `id` and `parentId` properties. The order in which the nodes 
appear in the `nodes` argument does not matter. This enables us to store the 
nodes in a flat table without worrying about the order in which they are 
added to the table and retrieve them without specific ordering (e.g., when 
storing in a relational database or 
[IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)).

`Operations` objects mentioned in the options (`operations` key) must 
implement the following method:

- `push(operation)` - the `operation` argument is an array that describes 
  the operation in the following format: `[name, timestamp, details]`

`Queue` objects mentioned in the options (`queue` key) must implement the 
following two methods:

- `set(nodeId, operation)` - the first parameter is a node id, and the value 
  is an array that describes the operation to be applied later in the 
  `[name, timestamp, details]` format
- `pop(nodeId)` - returns all operations set for a given `nodeId`

The operation arrays consist of three elements:

- string - representing the operation name
- timestamp - which is a return value from the `getTime()` method passed as an 
  option
- details - an object with arbitrary structure (this structure should be 
  considered implementation detail)

### `getNode(tree, nodeId)`

Retrieves a node matching the specified id.

Parameters:

- `tree` - a CRDT tree object created using `createTree()`
- `nodeId` - the node ID

Return value:

A node object matching the `nodeId`. If no such nodes exist, returns 
`undefined`.

Notes:

The returned node object will have an additional non-enumerable (does not appear
when iterating over the object keys) property `childNodes` which evaluates to a
list of the node's child nodes or an empty array if no such nodes exist.

### `getNodes(tree)`

Return a list of all nodes in the tree in insertion order.

Parameters:

- `tree` - a CRDT tree object created using `createTree()`

Return value:

Array of node objects.

Notes:

Each node object will have an additional non-enumerable (does not appear when 
iterating over the object keys) property `childNodes` which evaluates to a 
list of the node's child nodes or an empty array if no such nodes exist.

### `getData(tree, nodeId)`

Returns the current data associated with a specified node.

Parameters:

- `tree` - a CRDT tree object created using `createTree()`
- `nodeId` - the node ID

Return value:

An object that maps the keys from the `node.data` object to the `value` 
portion of each key's value.

### `getValue(tree, nodeId, key)`

Returns the current value of the specified key associated with the specified 
node.

Parameters:

- `tree` - a CRDT tree object created using `createTree()`
- `nodeId` - the node ID
- `key` - a key

Return value:

The current value of the specified key. If the node or the key do not exist, 
`undefined` is returned.

Notes:

There is no way of determining whether it is the node or the key that is 
missing.

### `setValue(tree, nodeId, key, value)`

Updates the value of the specified key on the specified node.

Parameters:

- `tree` - a CRDT tree object created using `createTree()`
- `nodeId` - the node ID
- `key` - a key
- `value` - a value

Return value:

None.

Preconditions:

The specified node must exist.

Operation:

This method generates a `'setValue'` operation.

Notes:

If the key does not exist on the node, it is created. The value's timestamp 
is updated every time the value is set.

### `insert(tree, parentId, refId, node)`

Inserts a node after the specified child node within the child list of the 
specified parent node.

Parameters:

- `tree` - a CRDT tree object created using `createTree()`
- `parentId` - an id of the node in whose child list the new node should be 
  inserted; an empty string represents the root node
- `refId` - the id of the node after which the new node should be inserted; an
  empty string represents the start of the child list
- `node` - an object containing the new node's data (this includes all 
  properties described in the section about node objects except the 
  `parentId`, which is set to the specified `parentId` value even if present)

Return value:

None.

Operation:

This method generates an `'insert'` operation.

Preconditions:

The node using the same id as the one in the `node` object must not already 
exist. Both the specified parent node and the reference node must exist and 
the reference node must be a child of the parent node.

Notes:

The `node` object will be shallow-copied in order to generate the operation 
details. This means that any properties that cannot be shallow-copied will 
not be transmitted to other replicas.

### `move(tree, nodeId, parentId, refId)`

Move a node to a new parent after the specified node within the parent's 
child list.

Parameters:

- `tree` - a CRDT tree object created using `createTree()`
- `nodeId` - an id of the node being moved
- `parentId` - an id of the node in whose child list the new node should be
  inserted; an empty string represents the root node
- `refId` - the id of the node after which the new node should be inserted; an
  empty string represents the start of the child list

Return value:

None.

Preconditions:

The node with the specified index must exist. Both the specified parent node 
and reference node must exist and the reference node must be a child of the 
parent node. The target location must not already be occupied by the node being 
moved.

Operation:

This method generates a `'move'` operation.

### `remove(tree, nodeId)`

Marks a specified node as removed.

Parameters:

- `tree` - a CRDT tree object created using `createTree()`
- `nodeId` - an id of the node being moved

Return value:

None.

Preconditions:

The node being removed must exist.

Operations:

This method generates a `'remove'` operation.

Notes:

This method is a does nothing when calling on a node that is already removed.

### `merge(tree, operations)`

Merge a list of operations into the tree.

Parameters:

- `tree` - a CRDT tree object created using `createTree()`
- `operations` - an array of operations

Return value:

None.

Notes:

Each element of the `operations` array is an array consisting of three elements:

- string - representing the operation name
- timestamp - which is a return value from the `getTime()` method passed as an
  option
- details - an object with arbitrary structure (this structure should be
  considered implementation detail)

### `purgeRemovedNodes(tree, [minAge = 0])`

Purges all removed nodes optionally limiting the purge to a specific age.

Parameters:

- `tree` - a CRDT tree object created using `createTree()`
- `minAge` - a value representing the difference in timestamp between 
  the next return value of the `getTime()` option passed to `createTree()` 
  and the value set as the node's `removed` property. Only nodes whose 
  difference is larger than `minAge` will be purged.

Return value:

An array of purged nodes' ids.

Notes:

This is a destructive operation, and it is impossible to recover the data 
once purged.
