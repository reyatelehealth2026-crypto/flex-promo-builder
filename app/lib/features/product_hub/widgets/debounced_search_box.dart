import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../product_hub_providers.dart';

/// Search field that debounces keystrokes (~250ms, same idea as the Electron
/// panel.js debounce) before writing into [searchQueryProvider].
class DebouncedSearchBox extends ConsumerStatefulWidget {
  const DebouncedSearchBox({super.key, this.debounce = const Duration(milliseconds: 250)});

  final Duration debounce;

  @override
  ConsumerState<DebouncedSearchBox> createState() => _DebouncedSearchBoxState();
}

class _DebouncedSearchBoxState extends ConsumerState<DebouncedSearchBox> {
  final TextEditingController _controller = TextEditingController();
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _timer?.cancel();
    _timer = Timer(widget.debounce, () {
      if (!mounted) return;
      ref.read(searchQueryProvider.notifier).state = value;
    });
  }

  void _clear() {
    _timer?.cancel();
    _controller.clear();
    ref.read(searchQueryProvider.notifier).state = '';
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      onChanged: _onChanged,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: 'ค้นหาชื่อสินค้า / รหัส (FTS5)',
        prefixIcon: const Icon(Icons.search),
        suffixIcon: ListenableBuilder(
          listenable: _controller,
          builder: (context, _) => _controller.text.isEmpty
              ? const SizedBox.shrink()
              : IconButton(
                  icon: const Icon(Icons.close),
                  tooltip: 'ล้างคำค้น',
                  onPressed: _clear,
                ),
        ),
        isDense: true,
        filled: true,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
      ),
    );
  }
}
