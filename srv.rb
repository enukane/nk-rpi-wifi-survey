require 'sinatra'
require 'json'
require 'fileutils'
require 'securerandom'
require 'tomlrb'
require 'open3'
require 'thread'

# Configure Sinatra
configure do
  set :bind, '0.0.0.0'
  set :port, 4567
  set :public_folder, 'public'
  enable :cross_origin
end

# Enable CORS
before do
  response.headers['Access-Control-Allow-Origin'] = '*'
  response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
  response.headers['Access-Control-Allow-Headers'] = 'Origin, Accept, Content-Type, X-Requested-With'
end

options "*" do
  response.headers["Allow"] = "GET, POST, PUT, DELETE, OPTIONS"
  response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, Accept, X-User-Email, X-Auth-Token"
  200
end

# Base directory for sessions and scans
BASE_DIR = File.join(Dir.pwd, 'data')
FileUtils.mkdir_p(BASE_DIR) unless Dir.exist?(BASE_DIR)

# Load configuration
begin
  CONFIG = TomlRB.load_file('config.toml')
rescue
  # Default commands if config file doesn't exist
  CONFIG = {
    'scanner' => {
      'channel_scan_cmd' => 'sudo iw wlan1 scan',
      'channel_busy_cmd' => 'sudo iw wlan1 survey dump',
      'spectrum_2ghz_cmd' => 'sudo ./wipry-lp -2',
      'spectrum_5ghz_cmd' => 'sudo ./wipry-lp -5',
      'spectrum_6ghz_cmd' => 'sudo ./wipry-lp -6'
    }
  }
end

# Session management
get '/api/sessions' do
  content_type :json
  sessions = Dir.glob(File.join(BASE_DIR, '*')).select { |f| File.directory?(f) }
    .map { |dir| File.basename(dir) }
  { sessions: sessions }.to_json
end

post '/api/sessions' do
  content_type :json
  data = JSON.parse(request.body.read)
  session_id = data['id'] || SecureRandom.uuid
  session_dir = File.join(BASE_DIR, session_id)

  FileUtils.mkdir_p(session_dir) unless Dir.exist?(session_dir)

  # If map image was provided, save it
  if data['map_image'] && data['map_image'].start_with?('data:image')
    image_data = data['map_image'].split(',')[1]
    File.open(File.join(session_dir, 'map.png'), 'wb') do |f|
      f.write(Base64.decode64(image_data))
    end
  end

  # Save session metadata
  File.open(File.join(session_dir, 'metadata.json'), 'w') do |f|
    f.write(JSON.generate({
      id: session_id,
      name: data['name'] || "Session #{session_id}",
      created_at: Time.now.to_i
    }))
  end

  { id: session_id, success: true }.to_json
end

get '/api/sessions/:id' do
  content_type :json
  session_id = params[:id]
  session_dir = File.join(BASE_DIR, session_id)

  if Dir.exist?(session_dir)
    metadata_file = File.join(session_dir, 'metadata.json')
    if File.exist?(metadata_file)
      metadata = JSON.parse(File.read(metadata_file))
    else
      metadata = { id: session_id }
    end

    # Get all scan points
    points_dir = File.join(session_dir, 'points')
    points = []

    if Dir.exist?(points_dir)
      Dir.glob(File.join(points_dir, '*')).select { |f| File.directory?(f) }.each do |point_dir|
        point_id = File.basename(point_dir)
        status_file = File.join(point_dir, 'status.json')

        if File.exist?(status_file)
          status = JSON.parse(File.read(status_file))
          points << {
            id: point_id,
            name: status['name'],
            x: status['x'],
            y: status['y'],
            status: status['status']
          }
        end
      end
    end

    # Check if map exists
    map_path = File.join(session_dir, 'map.png')
    has_map = File.exist?(map_path)

    { id: session_id, metadata: metadata, points: points, has_map: has_map }.to_json
  else
    status 404
    { error: 'Session not found' }.to_json
  end
end

delete '/api/sessions/:id' do
  content_type :json
  session_id = params[:id]
  session_dir = File.join(BASE_DIR, session_id)

  if Dir.exist?(session_dir)
    FileUtils.rm_rf(session_dir)
    { success: true }.to_json
  else
    status 404
    { error: 'Session not found' }.to_json
  end
end

# Serve map image
get '/api/sessions/:id/map' do
  session_id = params[:id]
  map_path = File.join(BASE_DIR, session_id, 'map.png')

  if File.exist?(map_path)
    content_type 'image/png'
    send_file map_path
  else
    status 404
    'Map not found'
  end
end

# Survey state management and scanning
get '/api/sessions/:session_id/points/:point_id/status' do
  content_type :json
  session_id = params[:session_id]
  point_id = params[:point_id]

  point_dir = File.join(BASE_DIR, session_id, 'points', point_id)
  status_file = File.join(point_dir, 'status.json')

  if File.exist?(status_file)
    status = JSON.parse(File.read(status_file))
    { status: status['status'] }.to_json
  else
    { status: 'SCAN_INACTIVE' }.to_json
  end
end

FREQ_TO_CHANNEL = {
  # 2.4 GHz
  '2412' => '1', '2417' => '2', '2422' => '3', '2427' => '4', '2432' => '5', 
  '2437' => '6', '2442' => '7', '2447' => '8', '2452' => '9', '2457' => '10', 
  '2462' => '11', '2467' => '12', '2472' => '13',
  # 5 GHz (partial mapping)
  '5180' => '36', '5200' => '40', '5220' => '44', '5240' => '48',
  '5260' => '52', '5280' => '56', '5300' => '60', '5320' => '64',
  '5500' => '100', '5520' => '104', '5540' => '108', '5560' => '112',
  '5580' => '116', '5600' => '120', '5620' => '124', '5640' => '128',
  '5660' => '132', '5680' => '136', '5700' => '140', '5720' => '144',
  '5745' => '149', '5765' => '153', '5785' => '157', '5805' => '161',
  '5825' => '165', '5845' => '169', '5865' => '173', '5885' => '177',
  # 6GHz
  '5955' => '1',
  '5975' => '5',
  '5995' => '9',
  '6015' => '13',
  '6035' => '17',
  '6055' => '21',
  '6075' => '25',
  '6095' => '29',
  '6115' => '33',
  '6135' => '37',
  '6155' => '41',
  '6175' => '45',
  '6195' => '49',
  '6215' => '53',
  '6235' => '57',
  '6255' => '61',
  '6275' => '65',
  '6295' => '69',
  '6315' => '73',
  '6335' => '77',
  '6355' => '81',
  '6375' => '85',
  '6395' => '89',
  '6415' => '93',
  '6435' => '97',
  '6455' => '101',
  '6475' => '105',
  '6495' => '109',
  '6515' => '113',
  '6535' => '117',
  '6555' => '121',
  '6575' => '125',
  '6595' => '129',
  '6615' => '133',
  '6635' => '137',
  '6655' => '141',
  '6675' => '145',
  '6695' => '149',
  '6715' => '153',
  '6735' => '157',
  '6755' => '161',
  '6775' => '165',
  '6795' => '169',
  '6815' => '173',
  '6835' => '177',
  '6855' => '181',
  '6875' => '185',
  '6895' => '189',
  '6915' => '193',
  '6935' => '197',
  '6955' => '201',
  '6975' => '205',
  '6995' => '209',
  '7015' => '213',
  '7035' => '217',
  '7055' => '221',
  '7075' => '225',
  '7095' => '229',
  '7115' => '233'
}

# Channel frequency ranges
CHANNEL_RANGES = {
  # 2.4 GHz channels (center frequencies and ranges)
  '2.4_1' => [2412, 2401.17, 2422.66],
  '2.4_2' => [2417, 2406.17, 2427.66],
  '2.4_3' => [2422, 2411.17, 2432.66],
  '2.4_4' => [2427, 2416.17, 2437.66],
  '2.4_5' => [2432, 2421.17, 2442.66],
  '2.4_6' => [2437, 2426.17, 2447.66],
  '2.4_7' => [2442, 2431.17, 2452.66],
  '2.4_8' => [2447, 2436.17, 2457.66],
  '2.4_9' => [2452, 2441.17, 2462.66],
  '2.4_10' => [2457, 2446.17, 2467.66],
  '2.4_11' => [2462, 2451.17, 2472.66],
  '2.4_12' => [2467, 2456.17, 2477.66],
  '2.4_13' => [2472, 2461.17, 2482.66],
  
  # 5 GHz channels (all channels with center and ranges)
  # UNII-1 (36-48)
  '5_36' => [5180, 5170, 5190],
  '5_40' => [5200, 5190, 5210],
  '5_44' => [5220, 5210, 5230],
  '5_48' => [5240, 5230, 5250],
  
  # UNII-2 (52-64)
  '5_52' => [5260, 5250, 5270],
  '5_56' => [5280, 5270, 5290],
  '5_60' => [5300, 5290, 5310],
  '5_64' => [5320, 5310, 5330],
  
  # UNII-2 Extended (100-144)
  '5_100' => [5500, 5490, 5510],
  '5_104' => [5520, 5510, 5530],
  '5_108' => [5540, 5530, 5550],
  '5_112' => [5560, 5550, 5570],
  '5_116' => [5580, 5570, 5590],
  '5_120' => [5600, 5590, 5610],
  '5_124' => [5620, 5610, 5630],
  '5_128' => [5640, 5630, 5650],
  '5_132' => [5660, 5650, 5670],
  '5_136' => [5680, 5670, 5690],
  '5_140' => [5700, 5690, 5710],
  '5_144' => [5720, 5710, 5730],
  
  # UNII-3 (149-177)
  '5_149' => [5745, 5735, 5755],
  '5_153' => [5765, 5755, 5775],
  '5_157' => [5785, 5775, 5795],
  '5_161' => [5805, 5795, 5815],
  '5_165' => [5825, 5815, 5835],
  '5_169' => [5845, 5835, 5855],
  '5_173' => [5865, 5855, 5875],
  '5_177' => [5885, 5875, 5895],
  
  # 6 GHz channels (U-NII-5 through U-NII-8)
  # 20MHz channels (1-233)
  '6_1' => [5945, 5935, 5955],
  '6_5' => [5965, 5955, 5975],
  '6_9' => [5985, 5975, 5995],
  '6_13' => [6005, 5995, 6015],
  '6_17' => [6025, 6015, 6035],
  '6_21' => [6045, 6035, 6055],
  '6_25' => [6065, 6055, 6075],
  '6_29' => [6085, 6075, 6095],
  '6_33' => [6105, 6095, 6115],
  '6_37' => [6125, 6115, 6135],
  '6_41' => [6145, 6135, 6155],
  '6_45' => [6165, 6155, 6175],
  '6_49' => [6185, 6175, 6195],
  '6_53' => [6205, 6195, 6215],
  '6_57' => [6225, 6215, 6235],
  '6_61' => [6245, 6235, 6255],
  '6_65' => [6265, 6255, 6275],
  '6_69' => [6285, 6275, 6295],
  '6_73' => [6305, 6295, 6315],
  '6_77' => [6325, 6315, 6335],
  '6_81' => [6345, 6335, 6355],
  '6_85' => [6365, 6355, 6375],
  '6_89' => [6385, 6375, 6395],
  '6_93' => [6405, 6395, 6415],
  '6_97' => [6425, 6415, 6435],
  '6_101' => [6445, 6435, 6455],
  '6_105' => [6465, 6455, 6475],
  '6_109' => [6485, 6475, 6495],
  '6_113' => [6505, 6495, 6515],
  '6_117' => [6525, 6515, 6535],
  '6_121' => [6545, 6535, 6555],
  '6_125' => [6565, 6555, 6575],
  '6_129' => [6585, 6575, 6595],
  '6_133' => [6605, 6595, 6615],
  '6_137' => [6625, 6615, 6635],
  '6_141' => [6645, 6635, 6655],
  '6_145' => [6665, 6655, 6675],
  '6_149' => [6685, 6675, 6695],
  '6_153' => [6705, 6695, 6715],
  '6_157' => [6725, 6715, 6735],
  '6_161' => [6745, 6735, 6755],
  '6_165' => [6765, 6755, 6775],
  '6_169' => [6785, 6775, 6795],
  '6_173' => [6805, 6795, 6815],
  '6_177' => [6825, 6815, 6835],
  '6_181' => [6845, 6835, 6855],
  '6_185' => [6865, 6855, 6875],
  '6_189' => [6885, 6875, 6895],
  '6_193' => [6905, 6895, 6915],
  '6_197' => [6925, 6915, 6935],
  '6_201' => [6945, 6935, 6955],
  '6_205' => [6965, 6955, 6975],
  '6_209' => [6985, 6975, 6995],
  '6_213' => [7005, 6995, 7015],
  '6_217' => [7025, 7015, 7035],
  '6_221' => [7045, 7035, 7055],
  '6_225' => [7065, 7055, 7075],
  '6_229' => [7085, 7075, 7095],
  '6_233' => [7105, 7095, 7115]
}

# Function to parse scan results and calculate metrics
def process_scan_results(point_dir)
  p "provcess_ca"
  results = { channels: {} }

  # Initialize channels data
  channels_2ghz = [1, 6, 11]
  channels_5ghz = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165, 169, 173, 177]
  channels_6ghz = [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85, 89, 93, 97, 101, 105, 109, 113, 117, 121, 125, 129, 133, 137, 141, 145, 149, 153, 157, 161, 165, 169, 173, 177, 181, 185, 189, 193, 197, 201, 205, 209, 213, 217, 221, 225, 229, 233]

  all_channels = channels_2ghz.map{ |c| "2.4_#{c}" } + channels_5ghz.map{ |c| "5_#{c}" } + channels_6ghz.map{ |c| "6_#{c}" }
  all_channels.each do |band_channel_key|
    results[:channels][band_channel_key] = {
      ap_count: 0,
      strong_ap_count: 0,
      channel_busy_rate: 0,
      channel_usage_rate: 0,
      score: 100  # Default score
    }
  end

  bss_hash = {}

  # Process iw scan results
  channel_scan_files = Dir.glob(File.join(point_dir, 'channel_scan_*.txt'))
  channel_scan_files.each do |file|
    current_bss = nil
    current_channel = nil
    signal_strength = nil
    last_seen_seconds = nil
    current_freq = nil

    File.readlines(file).each do |line|
      if line.match(/^BSS (.+)\(on (.+)\)/)
        current_bss= $1
        if bss_hash[current_bss] == nil
          bss_hash[current_bss] = {
            :channel_freq => nil,
            :channel_num => nil,
            :signal_strength => nil,
            :last_seen_seconds => nil
          }
        end
      elsif line.match(/\s+freq: (\d+)/)
        next unless current_bss
        next unless bss_hash[current_bss]
        current_freq = $1.to_i
        bss_hash[current_bss][:channel_freq] = current_freq
      elsif line.match(/\s+signal: (.+) dBm/)
        next unless current_bss
        next unless bss_hash[current_bss]
        signal_strength = $1.to_f
        bss_hash[current_bss][:signal_strength] = signal_strength
      elsif line.match(/\s+DS Parameter set: channel (\d+)/)
        next unless current_bss
        next unless bss_hash[current_bss]
        current_channel = $1.to_i
        bss_hash[current_bss][:channel_num] = current_channel
      elsif line.match(/\s+last seen: (\d+) (m?s) ago/)
        next unless current_bss
        next unless bss_hash[current_bss]
        val = $1.to_i
        is_ms = $2 == "ms"
        last_seen_seconds = val
        if is_ms
          last_seen_seconds /= 1000
        end
        bss_hash[current_bss][:last_seen_seconds] = last_seen_seconds
      end
    end

    bss_hash.each do |bssid, hash|
      next unless hash[:channel_num]
      channel_num = hash[:channel_num]
      channel_freq = hash[:channel_freq]

      band = if channel_freq < 3000
               '2.4'
             elsif channel_freq > 5920
               '6'
             else
               '5'
             end
      band_channel_key = "#{band}_#{channel_num}"

      if results[:channels].key?(band_channel_key)
        results[:channels][band_channel_key][:ap_count] += 1
        if hash[:signal_strength] >= -80
          results[:channels][band_channel_key][:strong_ap_count] += 1
        end
      end
    end
  end

  # Process channel busy rate from survey dump
  survey_files = Dir.glob(File.join(point_dir, 'survey_dump_*.txt'))
  channel_busy_rates = {}

  survey_files.each do |file|
    current_freq = nil
    active_time = nil
    busy_time = nil

    File.readlines(file).each do |line|
      if line.match(/^\s+frequency:\s+(\d+) MHz/)
        current_freq = $1.to_i
        if channel_busy_rates[current_freq].nil?
          channel_busy_rates[current_freq] = {
            :active_times_ms => 0,
            :busy_times_ms => 0,
          }
        end
      elsif line.match(/^\s+channel active time:\s+(\d+) (m?s)/)
        next unless current_freq
        next unless channel_busy_rates[current_freq]
        active_times_ms = $1.to_f
        is_s = $1 == "s"
        active_times_ms *= 1000 if is_s
        channel_busy_rates[current_freq][:active_times_ms] += active_times_ms
      elsif line.match(/^\s+channel busy time:\s+(\d+) (m?s)/)
        next unless current_freq
        next unless channel_busy_rates[current_freq]
        busy_times_ms = $1.to_f
        is_s = $1 == "s"
        busy_times_ms *= 1000 if is_s
        channel_busy_rates[current_freq][:busy_times_ms] += busy_times_ms
      end
    end
  end

  # Convert frequencies to channels and calculate average busy rate
  channel_busy_rates.each do |freq, hash|
    active_times_ms = hash[:active_times_ms]
    busy_times_ms = hash[:busy_times_ms]
    next if active_times_ms == 0.0
    busy_rates = (busy_times_ms / active_times_ms) * 100.0

    channel_num = FREQ_TO_CHANNEL[freq.to_s]

    band = if freq < 3000
             '2.4'
           elsif freq > 5920
             '6'
           else
             '5'
           end
    next if band == '2.4' and ![1,6,11].include?(channel_num.to_i)
    band_channel_key = "#{band}_#{channel_num}"

    if results[:channels][band_channel_key][:channel_busy_rate]
      results[:channels][band_channel_key][:channel_busy_rate] = busy_rates.round(2)
    end
  end

  # Process spectrum analyzer data
  spectrum_files = {
    '2.4' => Dir.glob(File.join(point_dir, 'spectrum_2ghz_*.txt')),
    '5' => Dir.glob(File.join(point_dir, 'spectrum_5ghz_*.txt')),
    '6' => Dir.glob(File.join(point_dir, 'spectrum_6ghz_*.txt'))
  }

  # Process spectrum data for each band
  spectrum_data = {}

  spectrum_files.each do |band, files|
    spectrum_data[band] = {}

    files.each do |file|
      lines = File.readlines(file).select { |line| line.include?("wipry,serial=") }

      lines.each do |line|
        # Extract the frequency-power pairs
        data_part = line.split(' ')[1].split(',')
        data_part.each do |item|
          if item.include?('=')
            freq_str, power_str = item.split('=')
            freq = freq_str.to_f
            power = power_str.to_f

            spectrum_data[band][freq] ||= []
            spectrum_data[band][freq] << power
          end
        end
      end
    end
  end

  CHANNEL_RANGES.each do |channel_key, range|
    center_freq, start_freq, end_freq = range

    band = channel_key.split('_').first

    if spectrum_data.key?(band)
      total_points = 0
      active_points = 0

      spectrum_data[band].each do |freq, powers|
        if freq >= start_freq && freq <= end_freq
          powers.each do |power|
            total_points += 1
            if power >= -85
              active_points += 1
            end
          end
        end
      end

      if total_points > 0
        usage_rate = (active_points.to_f / total_points.to_f) * 100
        if results[:channels].key?(channel_key)
          results[:channels][channel_key][:channel_usage_rate] = usage_rate.round(2)
        end
      end
    end
  end

  # AP情報を処理する部分も同様に修正（チャネルから帯域を判断）
  
  # スコア計算部分も同様に修正（帯域を含むキーを使用）
  results[:channels].each do |band_channel_key, data|
    # Start with 100 points
    score = 100
    
    # Subtract 1 for each AP
    score -= data[:ap_count]
    
    # Subtract 5 for each strong AP (-85dBm or better)
    score -= (data[:strong_ap_count] * 5)
    
    # Calculate the maximum of channel busy rate and usage rate, then subtract twice that value
    max_rate = [data[:channel_busy_rate], data[:channel_usage_rate]].max
    score -= (max_rate * 2)
    
    # Ensure score doesn't go below 0
    score = [score, 0].max
    
    results[:channels][band_channel_key][:score] = score.round(2)
  end
  
  # Save the processed results
  File.open(File.join(point_dir, 'results.json'), 'w') do |f|
    f.write(JSON.generate(results))
  end

#  # Calculate channel usage rates based on spectrum data
#  channel_ranges.each do |channel_key, range|
#    center_freq, start_freq, end_freq = range
#    
#    # チャネルキーから帯域を取得（2.4_1、5_36、6_1などから2.4、5、6を抽出）
#    band = channel_key.split('_').first
#    
#    # チャネル番号を抽出（2.4_1、5_36、6_1などから1、36、1を抽出）
#    channel_num = channel_key.split('_').last
#    
#    if spectrum_data.key?(band)
#      total_points = 0
#      active_points = 0
#      
#      spectrum_data[band].each do |freq, powers|
#        if freq >= start_freq && freq <= end_freq
#          powers.each do |power|
#            total_points += 1
#            if power >= -85
#              active_points += 1
#            end
#          end
#        end
#      end
#      
#      if total_points > 0
#        usage_rate = (active_points.to_f / total_points.to_f) * 100
#        
#        # 結果を保存する際はチャネル番号のみを使用（フロントエンドとの互換性のため）
#        if results[:channels].key?(channel_num)
#          results[:channels][channel_num][:channel_usage_rate] = usage_rate
#        end
#      end
#    end
#  end
#  # Calculate final scores for each channel
#  results[:channels].each do |channel, data|
#    # Start with 100 points
#    score = 100
#
#    # Subtract 1 for each AP
#    score -= data[:ap_count]
#
#    # Subtract 5 for each strong AP (-85dBm or better)
#    score -= (data[:strong_ap_count] * 5)
#
#    # Calculate the maximum of channel busy rate and usage rate, then subtract twice that value
#    max_rate = [data[:channel_busy_rate], data[:channel_usage_rate]].max
#    score -= (max_rate * 2)
#
#    # Ensure score doesn't go below 0
#    score = [score, 0].max
#
#    results[:channels][channel][:score] = score.round(2)
#  end
#
#  # Save the processed results
#  File.open(File.join(point_dir, 'results.json'), 'w') do |f|
#    f.write(JSON.generate(results))
#  end

  results
end

# Start a new scan
post '/api/sessions/:session_id/points/:point_id/scan' do
  content_type :json
  session_id = params[:session_id]
  point_id = params[:point_id]
  data = JSON.parse(request.body.read)

  session_dir = File.join(BASE_DIR, session_id)
  return { error: 'Session not found' }.to_json unless Dir.exist?(session_dir)

  points_dir = File.join(session_dir, 'points')
  FileUtils.mkdir_p(points_dir) unless Dir.exist?(points_dir)

  point_dir = File.join(points_dir, point_id)
  FileUtils.mkdir_p(point_dir) unless Dir.exist?(point_dir)

  # Update status to SCAN_ACTIVE
  status = {
    id: point_id,
    name: data['name'] || "Point #{point_id}",
    x: data['x'],
    y: data['y'],
    status: 'SCAN_ACTIVE',
    started_at: Time.now.to_i
  }

  File.open(File.join(point_dir, 'status.json'), 'w') do |f|
    f.write(JSON.generate(status))
  end

  # Start scanning in a separate thread
  Thread.new do
    begin
      # 1. Channel scan (5 times)
      5.times do |i|
        output, _ = Open3.capture2(CONFIG['scanner']['channel_scan_cmd'])
        File.open(File.join(point_dir, "channel_scan_#{i + 1}.txt"), 'w') { |f| f.write(output) }

        output, _ = Open3.capture2(CONFIG['scanner']['channel_busy_cmd'])
        File.open(File.join(point_dir, "survey_dump_#{i + 1}.txt"), 'w') { |f| f.write(output) }

        sleep 1 # Short delay between scans
      end

      # 2. Spectrum analyzer scans (for 2.4GHz, 5GHz, and 6GHz)
      ['2ghz', '5ghz', '6ghz'].each do |band|
        cmd = CONFIG['scanner']["spectrum_#{band}_cmd"]

        begin
          # Run the spectrum analyzer, capture 10 samples, then terminate
          output = ""
          IO.popen(cmd, "r") do |io|
            sample_count = 0
            timeout = Time.now + 20  # 20 second maximum timeout

            while line = io.gets
              output += line
              sample_count += 1 if line.include?("wipry,serial=")

              # Break after 10 samples or timeout
              if sample_count >= 10 || Time.now > timeout
                Process.kill("TERM", io.pid) rescue nil
                break
              end
            end
          end

          File.open(File.join(point_dir, "spectrum_#{band}_1.txt"), 'w') { |f| f.write(output) }
        rescue => e
          puts "Error running spectrum scan for #{band}: #{e.message}"
        end
      end

      # 3. Process the results
      process_scan_results(point_dir)

      
      print(status)
      status['status'] = 'SCAN_DONE'
      status['completed_at'] = Time.now.to_i

      File.open(File.join(point_dir, 'status.json'), 'w') do |f|
        f.write(JSON.generate(status))
      end
    rescue => e
      puts "Error during scan: #{e.message}"
      status['status'] = 'SCAN_INACTIVE'
      status['error'] = e.message

      File.open(File.join(point_dir, 'status.json'), 'w') do |f|
        f.write(JSON.generate(status))
      end
    end
  end

  { success: true, status: 'SCAN_ACTIVE' }.to_json
end

# Get results for a specific scan point
get '/api/sessions/:session_id/points/:point_id/results' do
  content_type :json
  session_id = params[:session_id]
  point_id = params[:point_id]

  point_dir = File.join(BASE_DIR, session_id, 'points', point_id)
  process_scan_results(point_dir)
  results_file = File.join(point_dir, 'results.json')

  if File.exist?(results_file)
    File.read(results_file)
  else
    status 404
    { error: 'Results not found' }.to_json
  end
end

# Start the web server
puts "Wi-Fi Field Survey Server started on http://localhost:4567"
