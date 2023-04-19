import * as crdtTree from './crdt-tree.js'
import util from 'node:util'
import {Console} from 'node:console'
import {Transform} from 'node:stream'
import assert from 'node:assert'

let
  TIMER = 0,
  TESTS = [],
  VERBOSE_DIFF = false,
  REPLICA_OPTIONS = {
    getTime: () => TIMER++,
  }

// Test markings:
// [U] - use cases
// [E] - error conditions
// [R] - regression

test('[U] Create replicas', function () {
  let A = crdtTree.createTree([
    createNode('', 'a', 'Top-level node', 0, 0.3974012),
    createNode('a', 'a1', 'Second-level node 1', 0, 0.41971283),
    createNode('a1', 'a2', 'Third', 0, 0.40198298),
    createNode('a', 'a3', 'Second-level node 2', 0, 0.690712309),
  ], {
    getTime() {return TIMER++}
  })

  assert.deepEqual(toTree(A, true), {
    a: {a1: {a2: {}}, a3: {}}
  })
  assert.deepEqual(crdtTree.getNode(A, 'a2'), {
    id: 'a2',
    parentId: 'a1',
    t: 6,
    vPos: 0.40198298,
    data: {
      label: {t: 7, value: 'Third'},
      x: {t: 8, value: 0}
    },
  })
})

test('[U] Insert a node at the start of the subtree', function () {
  let [A] = createReplicas()
  crdtTree.insert(A, 'a', '', createNode(undefined, 'a3', 'Inserted', 0))
  assertSubtreeOrder(A, 'a', ['a3', 'a1', 'a2'])
})

test('[U] Insert a node after one of the existing nodes', function () {
  let [A] = createReplicas()
  crdtTree.insert(A, 'a', 'a1', createNode(undefined, 'a3', 'Inserted', 0))
  assertSubtreeOrder(A, 'a', ['a1', 'a3', 'a2'])
})

test('[U] Insert multiple nodes after an existing node', function () {
  let [A] = createReplicas()
  crdtTree.insert(A, 'a', 'a1', createNode(undefined, 'a3', 'Inserted', 0))
  crdtTree.insert(A, 'a', 'a1', createNode(undefined, 'a4', 'Inserted', 0))
  assertSubtreeOrder(A, 'a', ['a1', 'a4', 'a3', 'a2'])
})

test('[E] Insert a node under a non-existent parent', function () {
  let [A] = createReplicas()
  assert.throws(function () {
    crdtTree.insert(A, 'x', 'a1', createNode(undefined, 'a3', 'Inserted', 0))
  }, crdtTree.UnmetPreconditionsError)
})

test('[E] Insert a node after a non-existent node', function () {
  let [A] = createReplicas()
  assert.throws(function () {
    crdtTree.insert(A, 'a', 'x1', createNode(undefined, 'a3', 'Inserted', 0))
  }, crdtTree.UnmetPreconditionsError)
})

test('[U] Insert node in one replica then sync', function () {
  let [A, B] = createReplicas()
  crdtTree.insert(A, '', 'b', createNode(undefined, 'c', 'Third', 4))
  assertSubtreeOrder(A, '', ['a', 'b', 'c'])
  mergeInto(B, A)
  assertConvergence(A, B)
})

test('[U] Insert one node in each replica then merge', function () {
  let [A, B] = createReplicas()
  crdtTree.insert(A, 'a', 'a2', createNode(undefined, 'a3', 'First 3', 4))
  crdtTree.insert(B, 'b', 'b3', createNode(undefined, 'b5', 'Second 4', 4))
  synchronize(A, B)
  assertConvergence(A, B)
})

test('[U] Insert a node in the same location in different replicas, then merge', function () {
  let [A, B] = createReplicas()
  crdtTree.insert(A, 'a', 'a2', createNode(undefined, 'a3', 'First 3', 4))
  crdtTree.insert(B, 'a', 'a2', createNode(undefined, 'a4', 'First 4', 4))
  synchronize(A, B)
  assertConvergence(A, B)
  assertHasNode(A, ['a', 'a3'])
  assertHasNode(A, ['a', 'a4'])
  assertHasNode(B, ['a', 'a3'])
  assertHasNode(B, ['a', 'a4'])
})

test('[U] Insert two nodes in one replica, and merge operations in reverse', function () {
  let [A, B] = createReplicas()
  crdtTree.insert(A, 'a', 'a2', createNode(undefined, 'a3', 'First 3', 4))
  crdtTree.insert(A, 'a', 'a3', createNode(undefined, 'a4', 'First 4', 4))
  mergeInto(B, A, reverse)
  assertConvergence(A, B)
})

test('[U] Move a node to the head of the same subtree', function () {
  let [A] = createReplicas()
  crdtTree.move(A, 'a2', 'a', '')
  assertSubtreeOrder(A, 'a', ['a2', 'a1'])
})

test('[U] Move a node to a different position within the same subtree', function () {
  let [A] = createReplicas()
  crdtTree.move(A, 'b3', 'b', 'b1')
  assertSubtreeOrder(A, 'b', ['b1', 'b3', 'b2', 'b4'])
})

test('[U] Move a node to the head of a different subtree', function () {
  let [A] = createReplicas()
  crdtTree.move(A, 'b3', 'a', '')
  assertSubtreeOrder(A, 'a', ['b3', 'a1', 'a2'])
  assertSubtreeOrder(A, 'b', ['b1', 'b2', 'b4'])
})

test('[U] Move a node after a node in a different subtree', function () {
  let [A] = createReplicas()
  crdtTree.move(A, 'b3', 'a', 'a1')
  assertSubtreeOrder(A, 'a', ['a1', 'b3', 'a2'])
  assertSubtreeOrder(A, 'b', ['b1', 'b2', 'b4'])
})

test('[E] Move a missing node', function () {
  let [A] = createReplicas()
  assert.throws(function () {
    crdtTree.move(A, 'x', 'b', 'b2')
  }, crdtTree.UnmetPreconditionsError)
})

test('[E] Move the node into itself', function () {
  let [A] = createReplicas()
  assert.throws(function () {
    crdtTree.move(A, 'b3', 'b', 'b2')
  }, crdtTree.UnmetPreconditionsError)
})

test('[E] Move a node to under a non-existent parent', function () {
  let [A] = createReplicas()
  assert.throws(function () {
    crdtTree.move(A, 'b3', 'x', 'b2')
  }, crdtTree.UnmetPreconditionsError)
})

test('[E] Move a node to after a non-existent node', function () {
  let [A] = createReplicas()
  assert.throws(function () {
    crdtTree.move(A, 'b3', 'b', 'x')
  }, crdtTree.UnmetPreconditionsError)
})

test('[U] Move nodes in a replica and then merge', function () {
  let [A, B] = createReplicas()
  crdtTree.move(A, 'b3', 'a', 'a1')
  mergeInto(B, A)
  assertConvergence(A, B)
})

test('[U] Move nodes in different replicas and then converge', function () {
  let [A, B] = createReplicas()
  crdtTree.move(A, 'b3', 'a', 'a1')
  crdtTree.move(B, 'b2', 'b', '')
  synchronize(A, B)
  assertConvergence(A, B)
})

test('[U] Move the same node in different replicas and then converge', function () {
  let [A, B] = createReplicas()
  crdtTree.move(A, 'b3', 'a', 'a1')
  crdtTree.move(B, 'b3', 'b', '')
  synchronize(A, B)
  assertConvergence(A, B)
  for (let r of [A, B]) {
    assertSubtreeOrder(r, 'a', ['a1', 'a2'])
    assertSubtreeOrder(r, 'b', ['b3', 'b1', 'b2', 'b4'])
  }
})

test('[U] Move different nodes to the same place in different replicas then converge', function () {
  let [A, B] = createReplicas()
  crdtTree.move(A, 'a1', 'a', 'a2')
  crdtTree.move(B, 'b3', 'a', 'a2')
  synchronize(A, B)
  assertConvergence(A, B)
  for (let r of [A, B]) {
    assertHasNode(r, ['a', 'a1'])
    assertHasNode(r, ['a', 'b3'])
    assertNoNode(r, ['b', 'b3'])
  }
})

test('[U] Move multiple nodes and merge the operations in reverse order', function () {
  let [A, B] = createReplicas()
  crdtTree.move(A, 'a1', 'a', 'a2')
  crdtTree.move(A, 'b1', 'a', 'a1')
  crdtTree.move(A, 'b3', 'b', 'b4')
  mergeInto(B, A, reverse)
  assertConvergence(A, B)
})

test('[U] Move an inserted node and then merge in reverse order', function () {
  let [A, B] = createReplicas()
  crdtTree.insert(A, 'a', 'a2', createNode(undefined, 'a3', 'Inserted', 0))
  crdtTree.move(A, 'a3', 'b', '')
  mergeInto(B, A, reverse)
  assertConvergence(A, B)
})

test('[U] Remove a node', function () {
  let [A] = createReplicas()
  crdtTree.remove(A, 'a1')
  assertSubtreeOrder(A, 'a', [removed('a1'), 'a2'])
})

test('[U] Remove a removed node', function () {
  let [A] = createReplicas()
  crdtTree.remove(A, 'a1')
  crdtTree.remove(A, 'a1')
  assert.equal(A.operations.length, 1)
  assertSubtreeOrder(A, 'a', [removed('a1'), 'a2'])
})

test('[E] Remove a non-existent node', function () {
  let [A] = createReplicas()
  assert.throws(function () {
    crdtTree.remove(A, 'x')
  }, crdtTree.UnmetPreconditionsError)
})

test('[U] Remove a node and then merge', function () {
  let [A, B] = createReplicas()
  crdtTree.remove(A, 'a1')
  mergeInto(B, A)
  assertConvergence(A, B)
})

test('[U] Remove nodes in each replica and then converge', function () {
  let [A, B] = createReplicas()
  crdtTree.remove(A, 'a1')
  crdtTree.remove(B, 'b1')
  synchronize(A, B)
  assertConvergence(A, B)
})

test('[U] Remove the same node in each replica and then converge', function () {
  let [A, B] = createReplicas()
  crdtTree.remove(A, 'a1')
  crdtTree.remove(B, 'a1')
  synchronize(A, B)
  assertConvergence(A, B)
  assert.equal(crdtTree.getNode(A, 'a1').removed, 25)
})

test('[U] Remove an inserted node and then merge in reverse order', function () {
  let [A, B] = createReplicas()
  crdtTree.insert(A, 'a', 'a2', createNode(undefined, 'a3', 'Inserted', 0))
  crdtTree.remove(A, 'a3')
  mergeInto(B, A, reverse)
  assertConvergence(A, B)
})

test('[U] Inserting a node after a node that is removed in a different replica', function () {
  let [A, B] = createReplicas()
  crdtTree.insert(A, 'a', 'a1', createNode(undefined, 'a3', 'Inserted', 0))
  crdtTree.remove(B, 'a1')
  synchronize(A, B, true)
  assertConvergence(A, B)

  crdtTree.remove(B, 'b3')
  crdtTree.insert(A, 'b', 'b3', createNode(undefined, 'b5', 'Inserted', 0))
  synchronize(A, B, true)
  assertConvergence(A, B)
})

test('[U] Removing then inserting a node, and merging in reverse', function () {
  let [A, B] = createReplicas()
  crdtTree.remove(A, 'a1')
  crdtTree.insert(A, 'a', 'a1', createNode(undefined, 'a3', 'Inserted', 0))
  mergeInto(B, A, reverse)
  assertConvergence(A, B)
})

test('[U] Removing then moving a node restores it', function () {
  let [A] = createReplicas()
  crdtTree.remove(A, 'a1')
  crdtTree.move(A, 'a1', 'a', 'a2')
  assertSubtreeOrder(A, 'a', ['a2', 'a1'])
})

test('[U] Remove a node that is moved in another replica', function () {
  let [A, B] = createReplicas()
  crdtTree.remove(A, 'a1')
  crdtTree.move(B, 'a1', 'a', 'a2')
  synchronize(A, B, true)
  assertConvergence(A, B)

  crdtTree.move(A, 'b1', 'b', 'b2')
  crdtTree.remove(B, 'b1')
  synchronize(A, B, true)
  assertConvergence(A, B)
})

test('[U] Insert a node after a node that is moved in another replica', function () {
  let [A, B] = createReplicas()
  crdtTree.insert(A, 'a', 'a1', createNode(undefined, 'a3', 'Inserted', 0))
  crdtTree.move(B, 'a1', 'a', 'a2')
  synchronize(A, B, true)
  assertConvergence(A, B)
  assertSubtreeOrder(A, 'a', ['a3', 'a2', 'a1'])

  crdtTree.move(A, 'b1', 'b', 'b2')
  crdtTree.insert(B, 'b', 'b1', createNode(undefined, 'b5', 'Inserted', 0))
  synchronize(A, B, true)
  assertConvergence(A, B)
  assertSubtreeOrder(A, 'b', ['b5', 'b2', 'b1', 'b3', 'b4'])
})

test('[U] Insert a node after a node that is moved to a different subtree', function () {
  let [A, B] = createReplicas()
  crdtTree.insert(A, 'a', 'a1', createNode(undefined, 'a3', 'Inserted', 0))
  crdtTree.move(B, 'a1', 'b', 'b2')
  synchronize(A, B, true)
  assertConvergence(A, B)
  assertSubtreeOrder(A, 'a', ['a3', 'a2'])
  assertSubtreeOrder(A, 'b', ['b1', 'b2', 'a1', 'b3', 'b4'])

  crdtTree.move(A, 'b1', 'a', 'a2')
  crdtTree.insert(B, 'b', 'b1', createNode(undefined, 'b5', 'Inserted', 0))
  synchronize(A, B, true)
  assertConvergence(A, B)
  assertSubtreeOrder(A, 'a', ['a3', 'a2', 'b1'])
  assertSubtreeOrder(A, 'b', ['b5', 'b2', 'a1', 'b3', 'b4'])
})

test('[U] Merging several of operations in order', function () {
  let [A, B] = createReplicas()
  crdtTree.insert(A, 'a', 'a2', createNode(undefined, 'a3', 'Inserted', 0))
  crdtTree.insert(A, 'a', 'a3', createNode(undefined, 'a4', 'Inserted', 0))
  crdtTree.move(A, 'b4', 'b', '')
  crdtTree.remove(A, 'b4')
  crdtTree.move(A, 'b1', 'a', '')
  mergeInto(B, A)
  assertConvergence(A, B)
})

test('[U] Merging several of operations with duplicates', function () {
  let [A, B] = createReplicas()
  crdtTree.insert(A, 'a', 'a2', createNode(undefined, 'a3', 'Inserted', 0))
  crdtTree.insert(A, 'a', 'a3', createNode(undefined, 'a4', 'Inserted', 0))
  crdtTree.move(A, 'b4', 'b', '')
  crdtTree.remove(A, 'b4')
  crdtTree.move(A, 'b1', 'a', '')
  mergeInto(B, A, function (operations) {
    return [...operations, ...operations]
  })
  assertConvergence(A, B)
})

test('[U] Merging several of operations in reverse', function () {
  let [A, B] = createReplicas()
  crdtTree.insert(A, 'a', 'a2', createNode(undefined, 'a3', 'Inserted', 0))
  crdtTree.insert(A, 'a', 'a3', createNode(undefined, 'a4', 'Inserted', 0))
  crdtTree.move(A, 'b4', 'b', '')
  crdtTree.remove(A, 'b4')
  crdtTree.move(A, 'b1', 'a', '')
  mergeInto(B, A, reverse)
  assertConvergence(A, B)
})

test('[U] Merging several of operations in random order', function () {
  let [A, B, C, D] = createReplicas(4)
  crdtTree.insert(A, 'a', 'a2', createNode(undefined, 'a3', 'Inserted', 0))
  crdtTree.insert(A, 'a', 'a3', createNode(undefined, 'a4', 'Inserted', 0))
  crdtTree.move(A, 'a4', 'b', '')
  crdtTree.remove(A, 'b4')
  crdtTree.move(A, 'b1', 'a', '')
  for (let r of [B, C, D]) {
    mergeInto(r, A, function (operations) {
      return operations.slice().sort(function () {
        return [-1, 0, 1][Math.round(Math.random() * 2)]
      })
    })
  }
  assertConvergence(A, B)
  assertConvergence(A, C)
  assertConvergence(A, D)
})

test('[U] Converge multiple replicas with conflicting changes', function () {
  let [A, B, C, D] = createReplicas(4)
  crdtTree.insert(A, 'a', 'a2', createNode(undefined, 'a3', 'Inserted', 0))
  crdtTree.move(B, 'b2', 'b', '')
  crdtTree.remove(C, 'b4')
  crdtTree.move(D, 'b1', 'a', 'a2')
  crdtTree.move(B, 'a2', 'b', '')
  crdtTree.remove(C, 'b1')
  crdtTree.move(A, 'b2', 'a', 'a2')

  let replicas = [A, B, C, D]
  for (let a of replicas) for (let b of replicas) if (a !== b)
    synchronize(a, b)

  assertConvergence(A, B)
  assertConvergence(B, C)
  assertConvergence(C, D)
})

test('[U] Merge move and remove operations that happened at the exact same time', function () {
  let [A, B] = createReplicas()
  let now = TIMER
  crdtTree.remove(A, 'a2')
  TIMER = now // rewind the clock
  crdtTree.move(B, 'a2', 'b', '')
  synchronize(A, B)
  assertConvergence(A, B)
  now = TIMER
  crdtTree.move(A, 'b2', 'a', '')
  TIMER = now // rewind the clock
  crdtTree.remove(B, 'b2')
  synchronize(A, B)
  assertConvergence(A, B)
})

test('[U] Set a node value', function () {
  let [A] = createReplicas()
  crdtTree.setValue(A, 'a2', 'label', 'Updated')
  assert.equal(crdtTree.getValue(A, 'a2', 'label'), 'Updated')
  assert.deepEqual(crdtTree.getData(A, 'a2'), {label: 'Updated', x: 1})
})

test('[U] Set a value and then merge', function () {
  let [A, B] = createReplicas()
  crdtTree.setValue(A, 'a2', 'label', 'Updated')
  mergeInto(B, A)
  assert.equal(crdtTree.getValue(B, 'a2', 'label'), 'Updated')
  assert.deepEqual(crdtTree.getData(B, 'a2'), {label: 'Updated', x: 1})
})

test('[U] Set values on different replicas and then converge', function () {
  let [A, B] = createReplicas()
  crdtTree.setValue(A, 'a2', 'label', 'Updated')
  crdtTree.setValue(B, 'b2', 'x', 12)
  synchronize(A, B)
  assertConvergence(A, B)
})

test('[U] Set the same value on different replicas and then converge', function () {
  let [A, B] = createReplicas()
  crdtTree.setValue(A, 'a2', 'label', 'Updated')
  crdtTree.setValue(B, 'a2', 'label', 'Updated More')
  crdtTree.setValue(B, 'b2', 'x', 12)
  crdtTree.setValue(A, 'b2', 'x', 24)
  synchronize(A, B)
  assertConvergence(A, B)
  assert.equal(crdtTree.getValue(A, 'a2', 'label'), 'Updated More')
  assert.equal(crdtTree.getValue(A, 'b2', 'x'), 24)
})

test('[U] Insert a node and set its value, then merge in reverse', function () {
  let [A, B] = createReplicas()
  crdtTree.insert(A, 'a', 'a2', createNode(undefined, 'a3', 'Inserted', 0))
  crdtTree.setValue(A, 'a3', 'label', 'Updated')
  mergeInto(B, A, reverse)
  assertConvergence(A, B)
  assert.equal(crdtTree.getValue(B, 'a3', 'label'), 'Updated')
})

test('[U] Purge removed nodes', function () {
  let [A] = createReplicas()
  crdtTree.remove(A, 'a1')
  crdtTree.purgeRemovedNodes(A)
  assertSubtreeOrder(A, 'a', ['a2'])
})

test('[U] Purge removed nodes with minimum age', function () {
  let [A] = createReplicas()
  TIMER = 30
  crdtTree.remove(A, 'a1')
  TIMER = 40
  crdtTree.remove(A, 'a2')
  TIMER = 50
  crdtTree.purgeRemovedNodes(A, 15)
  assertSubtreeOrder(A, 'a', [removed('a2')])
})

// Selecting tests to run:
//
// run(/^Some test title$/) - run tests that exactly matches "Some test title"
// run(/^Move /) - run tests that start with "Move " regexp
// run(12) - run the test at index 12
// run(-1) - run the last test
//
run()

// Runner

function test(name, fn) {
  TESTS.push([name, fn])
}
function run(selector) {
  let matcher = () => true
  if (selector?.constructor === RegExp) matcher = function (name) {return selector.test(name)}
  if (selector?.constructor === Number) {
    if (selector < 0) matcher = function (_, index) {return TESTS.length + selector === index}
    else matcher = function (_, index) {return selector === index}
  }
  for (let i = 0; i < TESTS.length; i++) {
    let [name, fn] = TESTS[i]
    if (fn && matcher(name, i)) {
      try {
        fn()
        console.log('PASS', name)
      } catch (e) {
        console.error('FAIL', name, e)
        break
      }
    }
  }
}

// Logging and diffing

function printTable(data) {
  let
    ts = new Transform({
      transform(chunk, enc, cb) {
        cb(null, chunk)
      }
    }),
    logger = new Console({stdout: ts})
  logger.table(data)
  return (ts.read() || '').toString()
}

function toTree(replica, idOnly = false) {
  let topLevelNodes = replica.subtreeLookup.get('')
  let tree = {}
  let queue = topLevelNodes.map(node => ({mount: tree, node}))
  for (let x, i = 0; x = queue[i]; i++) {
    x.mount[x.node.id] = idOnly ? {} : {t: x.node.t, vPos: x.node.vPos, removed: x.node.removed, data: x.node.data}
    if (x.node.subtree.length) for (let subnode of x.node.subtree)
      queue.push({mount: x.mount[x.node.id], node: subnode})
  }
  return tree
}

function diffReplicas(replicaA, replicaB) {
  let
    uniqueIds = new Set([...replicaA.idLookup.keys(), ...replicaB.idLookup.keys()]),
    diffs = []

  for (let id of uniqueIds) {
    if (id === '') continue

    let
      a = replicaA.idLookup.get(id),
      b = replicaB.idLookup.get(id)

    // Diff presence in other replica
    if (!a && b) {
      diffs.push({node: id, B: b})
      continue
    }
    if (a && !b) {
      diffs.push({node: id, A: a})
      continue
    }

    // Diff the members
    if (a.parentId !== b.parentId) diffs.push({node: id, property: 'parentId', A: a.parentId, B: b.parentId})
    if (a.t != b.t) diffs.push({node: id, property: 't', A: a.t, B: b.t})
    if (a.vPos != b.vPos) diffs.push({node: id, property: 'vPos', A: a.vPos, B: b.vPos})
    if (a.removed != b.removed) diffs.push({node: id, property: 'removed', A: a.removed, B: b.remove})

    // Diff data
    let keys = new Set([...Object.keys(a.data), ...Object.keys(b.data)])
    for (let k of keys) {
      if (!(k in a.data)) {
        diffs.push({node: id, property: `data[${k}]`, B: b.data[k]})
        continue
      }
      if (!(k in b.data)) {
        diffs.push({node: id, property: `data[${k}]`, A: a.data[k]})
        continue
      }
      if (a.data[k].value !== b.data[k].value)
        diffs.push({node: id, property: `data[${k}].value`, A: a.data[k].value, B: a.data[k].value})
      else if (a.data[k].t !== b.data[k].t)
        diffs.push({node: id, property: `data[${k}].t`, A: a.data[k].t, B: a.data[k].t})
    }
  }
  return diffs
}

// Assertions

function assertConvergence(replicaA, replicaB) {
  let diff = diffReplicas(replicaA, replicaB)
  if (diff.length)
    throw new assert.AssertionError({
      message: `Replicas did not converge:
    
${printTable(diff)}` + (!VERBOSE_DIFF ? '' : `
A:

${util.inspect(toTree(replicaA), {depth: null, colors: true})}

B:

${util.inspect(toTree(replicaB), {depth: null, colors: true})}`),
      actual: false,
      expected: true,
    })
}

function findNode(replica, path) {
  let current = replica.root
  let pathLooked = []
  for (let p of path) {
    pathLooked.push(p)
    current = current.subtree.find(function (node) {return node.id === p})
    if (!current) return {found: false, looked: pathLooked}
  }
  return {found: true}
}

function assertHasNode(replica, path) {
  let result = findNode(replica, path)
  if (!result.found)
    throw new assert.AssertionError({
      message: `Expected to find a node at  ${path.join('->')}, but found none after ${result.looked.join('->')})`,
      expected: true,
      actual: false,
    })
}

function assertNoNode(replica, path) {
  let result = findNode(replica, path)
  if (result.found)
    throw new assert.AssertionError({
      message: `Expected to find no nodes at  ${path.join('->')}, but found one at ${result.looked.join('->')}`,
      expected: false,
      actual: true,
    })
}

function assertSubtreeOrder(replica, nodeId, subtreeIds) {
  let node = crdtTree.getNode(replica, nodeId)
  let actualSubtreeIds = node.subtree.map(x => x.id + (x.removed == null ? '' : '[[REMOVED]]'))
  if (!node) throw new assert.AssertionError({
    message: `Expected subtree order of ${nodeId} to match [${subtreeIds.join(', ')}], but ${nodeId} was not found`,
    expected: subtreeIds,
    actual: null,
  })

  subtreeIds = subtreeIds.map(x => typeof x === 'string' ? x : x.nodeId + (x.removed ? '[[REMOVED]]' : ''))

  function comparison() {
    let out = []
    for (let i = 0; i < Math.max(subtreeIds.length, actualSubtreeIds.length); i++) {
      let expected = subtreeIds[i], actual = actualSubtreeIds[i]
      out.push({expected, actual, match: expected === actual})
    }
    return printTable(out)
  }

  if (subtreeIds.length != actualSubtreeIds.length) throw new assert.AssertionError({
    message: `Expected ${nodeId} subtree to match but they have different lengths:
  
${comparison()}`,
    expected: subtreeIds,
    actual: actualSubtreeIds,
  })
  for (let i = 0; i < subtreeIds.length; i++) {
    if (actualSubtreeIds[i] !== subtreeIds[i]) throw new assert.AssertionError({
      message: `Expected ${nodeId} subtree to match, but they diverge at index ${i}:
    
${comparison()}`,
      expected: subtreeIds,
      actual: actualSubtreeIds,
    })
  }
}

// Merging

function mergeInto(replicaA, replicaB, process = function (operations) {return operations}) {
  crdtTree.merge(replicaA, process(replicaB.operations))
}

function synchronize(replicaA, replicaB, clear = false) {
  mergeInto(replicaA, replicaB)
  mergeInto(replicaB, replicaA)
  if (clear) {
    replicaA.operations.length = false
    replicaB.operations.length = false
  }
}

function reverse(xs) {
  return xs.reverse()
}

function removed(nodeId) {
  return {nodeId, removed: true}
}

// Fixture creation

function createNode(parentId, id, label, x, vPos) {
  let node = {
    id,
    parentId,
    t: TIMER++,
    vPos,
    data: {
      label: {value: label, t: TIMER++},
      x: {value: x, t: TIMER++},
    }
  }
  return node
}

function initialState() {
  TIMER = 0
  return [
    createNode('', 'a', 'First', 0, 0.389187740123),
    createNode('a', 'a1', 'First 1', 2, 0.394881008923),
    createNode('a', 'a2', 'First 2', 1, 0.671023098412),
    createNode('', 'b', 'Second', 2, 0.410820947120),
    createNode('b', 'b1', 'Second 1', 3, 0.420481098232),
    createNode('b', 'b2', 'Second 2', 3, 0.690299812392),
    createNode('b', 'b3', 'Second 3', 4, 0.860180308213),
    createNode('b', 'b4', 'Second 4', 0, 0.988428973131),
  ]
}

function createReplicas(n = 2) {
  let out = []
  while (n--) out.push(crdtTree.createTree(initialState(), REPLICA_OPTIONS))
  return out
}
