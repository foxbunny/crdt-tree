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
within a subtree, or when two replicas move different nodes to the same position
within a subtree, the timestamp is used as a tie-breaker to order the two nodes
in a consistent and predictable way by pushing the later-added node to a later
position within the list. Timestamps are also used to determine the precedence 
of the operations. For example, if a node is moved and deleted at the same time, 
the deleted node may be restored if the move happened later.

The virtual position, `vPos`, is used to determine the relative position of the
node within a subtree. Because nodes in the subtree may be moved or inserted
concurrently, it is not possible to rely on list indices or identifiers of the
surrounding nodes to specify the intended position of the node. In this
implementation, we instead use a virtual position, a number between 0 and 1 that
represents the relative position of the node within the subtree. The 0
represents the start of the list, and the 1 represents the end of the list, and
these numbers are never assigned to the actual nodes. 

When nodes are inserted into subtrees, they are given a virtual position that is
"somewhere" between the the virtual positions of the adjacent nodes. When nodes
are being placed at the very ends of the subtree, and there is only one 
adjacent node, the numbers 0 and 1 mentioned before play the role of the virtual
position of the other node, and those values are thus reserved for this purpose.

The virtual position numbers are randomly jittered by a small factor to reduce
the chances of a conflict, and are also biased towards the start of the range by
a factor of 0.4. The bias is there so as to leave a larger range of values
towards the tail end of the list as the likelihood of elements being added to
the tail is generally higher than insertion at the head. The value of 0.4 was
chosen arbitrarily and may be adjusted or made adjustable in future once we have
some real life data about its impact.

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

## API reference

TODO
