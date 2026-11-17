import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:get_storage/get_storage.dart';

import '../domain/entities/catalog_item.dart';
import '../domain/repositories/catalog_repository.dart' as domain;

/// Reads a setting from the bundled `.env` file (loaded in main), then from
/// `--dart-define`, so a build flag can still override the file.
String _setting(String name, String fromDefine) {
  if (fromDefine.isNotEmpty) return fromDefine;
  return dotenv.isInitialized ? (dotenv.maybeGet(name) ?? '').trim() : '';
}

/// API_BASE_URL from `.env` (e.g. https://nexo-iota-jet.vercel.app/api/v1). Without
/// it the Android emulator reaches the host machine's local API through 10.0.2.2.
String _apiBaseUrl() {
  final configured = _setting(
      'API_BASE_URL', const String.fromEnvironment('API_BASE_URL'));
  if (configured.isNotEmpty) return configured;
  final emulatorHost =
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
  return emulatorHost
      ? 'http://10.0.2.2:4000/api/v1'
      : 'http://localhost:4000/api/v1';
}

/// APP_API_KEY from `.env`: one of the API's APP_API_KEYS. The production API
/// rejects requests without it; a local API without APP_API_KEYS accepts them.
String _apiKey() =>
    _setting('APP_API_KEY', const String.fromEnvironment('APP_API_KEY'));

class CatalogRepository implements domain.CatalogRepository {
  CatalogRepository({Dio? client, GetStorage? storage})
      : _client = client ??
            Dio(BaseOptions(
                baseUrl: _apiBaseUrl(),
                headers: {if (_apiKey().isNotEmpty) 'X-API-Key': _apiKey()},
                connectTimeout: const Duration(seconds: 8),
                receiveTimeout: const Duration(seconds: 25))),
        _storage = storage ?? GetStorage();

  final Dio _client;
  final GetStorage _storage;

  List<CatalogItem> _items(dynamic body) =>
      (body is List ? body : const <dynamic>[])
          .map((item) =>
              CatalogItem.fromJson(Map<String, dynamic>.from(item as Map)))
          .toList();

  @override
  Future<HomeFeed> home(String tab) async {
    final response = await _client
        .get<Map<String, dynamic>>('/home', queryParameters: {'tab': tab});
    final data = response.data?['data'];
    return data is Map
        ? HomeFeed.fromJson(Map<String, dynamic>.from(data))
        : const HomeFeed();
  }

  @override
  Future<List<CatalogItem>> channels(
      {String query = '', String category = ''}) async {
    final response =
        await _client.get<Map<String, dynamic>>('/channels', queryParameters: {
      'limit': 1000,
      if (query.isNotEmpty) 'q': query,
      if (category.isNotEmpty) 'category': category
    });
    return _items(response.data?['data']);
  }

  Map<String, dynamic> _contentQuery(String query, String genre,
          String language, String list, int? year, int page) =>
      {
        'page': page,
        if (query.isNotEmpty) 'q': query,
        if (genre.isNotEmpty) 'genre': genre,
        if (language.isNotEmpty) 'language': language,
        if (list.isNotEmpty) 'list': list,
        if (year != null) 'year': year,
      };

  @override
  Future<List<CatalogItem>> movies(
      {String query = '',
      String genre = '',
      String language = '',
      String list = '',
      int? year,
      int page = 1}) async {
    final response = await _client.get<Map<String, dynamic>>('/movies',
        queryParameters:
            _contentQuery(query, genre, language, list, year, page));
    return _items(response.data?['data']);
  }

  @override
  Future<List<CatalogItem>> series(
      {String query = '',
      String genre = '',
      String language = '',
      String list = '',
      int? year,
      int page = 1}) async {
    final response = await _client.get<Map<String, dynamic>>('/series',
        queryParameters:
            _contentQuery(query, genre, language, list, year, page));
    return _items(response.data?['data']);
  }

  @override
  Future<List<CatalogItem>> search(String query) async {
    if (query.trim().isEmpty) return [];
    final response = await _client
        .get<Map<String, dynamic>>('/search', queryParameters: {'q': query});
    return _items(response.data?['data']);
  }

  @override
  Future<CatalogItem?> movie(String slug) async {
    final response = await _client
        .get<Map<String, dynamic>>('/movies/${Uri.encodeComponent(slug)}');
    final data = response.data?['data'];
    return data is Map
        ? CatalogItem.fromJson(Map<String, dynamic>.from(data))
        : null;
  }

  @override
  Future<CatalogItem?> seriesDetails(String slug) async {
    final response = await _client
        .get<Map<String, dynamic>>('/series/${Uri.encodeComponent(slug)}');
    final data = response.data?['data'];
    return data is Map
        ? CatalogItem.fromJson(Map<String, dynamic>.from(data))
        : null;
  }

  @override
  Future<List<CatalogSeason>> seasons(String slug) async {
    final response = await _client.get<Map<String, dynamic>>(
        '/series/${Uri.encodeComponent(slug)}/seasons');
    return (response.data?['data'] as List? ?? const <dynamic>[])
        .map((item) =>
            CatalogSeason.fromJson(Map<String, dynamic>.from(item as Map)))
        .toList();
  }

  @override
  Future<List<String>> categories() async {
    final response =
        await _client.get<Map<String, dynamic>>('/channels/categories');
    return (response.data?['data'] as List? ?? const <dynamic>[])
        .map((item) => '${(item as Map)['name']}')
        .toList();
  }

  @override
  Future<String?> channelYoutubeLive(String slug) async {
    final response = await _client.get<Map<String, dynamic>>(
        '/channels/${Uri.encodeComponent(slug)}/youtube-live');
    final data = response.data?['data'];
    final url = data is Map ? data['playbackUrl'] : null;
    return url is String && url.isNotEmpty ? url : null;
  }

  @override
  Future<List<CatalogItem>> saved() async {
    final values =
        _storage.read<List<dynamic>>('nexo.my_list') ?? const <dynamic>[];
    return values
        .whereType<Map<dynamic, dynamic>>()
        .map((value) => CatalogItem.fromJson(Map<String, dynamic>.from(value)))
        .toList();
  }

  @override
  Future<void> save(CatalogItem item) async {
    final values = (await saved())
        .where((value) => value.id != item.id)
        .toList()
      ..add(item);
    await _storage.write(
        'nexo.my_list', values.map((value) => value.toJson()).toList());
  }

  @override
  Future<void> remove(String id) async {
    final values = (await saved()).where((value) => value.id != id).toList();
    await _storage.write(
        'nexo.my_list', values.map((value) => value.toJson()).toList());
  }
}
