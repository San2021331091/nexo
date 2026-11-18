import 'package:get_storage/get_storage.dart';

import '../domain/entities/assistant.dart';

/// Keeps NEXO Assistant chats and memory on the device, like the My List.
/// Nothing here is sent anywhere except the memory facts, which go with each
/// question so answers can be personalised.
class AssistantStore {
  AssistantStore([GetStorage? storage]) : _storage = storage ?? GetStorage();
  final GetStorage _storage;

  static const _chatsKey = 'nexo.assistant.chats';
  static const _memoryKey = 'nexo.assistant.memory';
  static const maxChats = 50;
  static const maxMemory = 30;

  /// Saved chats, newest first.
  List<AssistantChat> chats() {
    final values = _storage.read<List<dynamic>>(_chatsKey) ?? const [];
    return values
        .whereType<Map<dynamic, dynamic>>()
        .map((value) =>
            AssistantChat.fromStorage(Map<String, dynamic>.from(value)))
        .whereType<AssistantChat>()
        .toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  }

  Future<void> saveChat(AssistantChat chat) async {
    final rest = chats().where((value) => value.id != chat.id);
    final values = [chat, ...rest].take(maxChats);
    await _storage
        .write(_chatsKey, [for (final value in values) value.toStorage()]);
  }

  Future<void> deleteChat(String id) async => _storage.write(_chatsKey, [
        for (final value in chats().where((value) => value.id != id))
          value.toStorage()
      ]);

  Future<void> clearChats() async => _storage.remove(_chatsKey);

  /// Facts the assistant remembers about the viewer, oldest first.
  List<String> memory() =>
      (_storage.read<List<dynamic>>(_memoryKey) ?? const [])
          .map((value) => '$value'.trim())
          .where((value) => value.isNotEmpty)
          .toList();

  /// Adds new facts, skipping ones already known, keeping the newest.
  Future<void> remember(List<String> facts) async {
    final known = memory();
    final lower = known.map((fact) => fact.toLowerCase()).toSet();
    for (final fact in facts) {
      if (lower.add(fact.toLowerCase())) known.add(fact);
    }
    final kept = known.length > maxMemory
        ? known.sublist(known.length - maxMemory)
        : known;
    await _storage.write(_memoryKey, kept);
  }

  Future<void> forget(String fact) async =>
      _storage.write(_memoryKey, memory()..remove(fact));

  Future<void> clearMemory() async => _storage.remove(_memoryKey);
}
