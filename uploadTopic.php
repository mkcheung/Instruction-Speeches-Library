<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("userrole.php");
require_once("category.php");
require_once("topic.php");
require_once("function.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

if(!isset($_SESSION['user_id']))
	redirect_to('login.php');

$categories = Category::find_all(); 
$topics = Topic::find_all(); 

if(isset($_POST['submit'])){

	$required_fields = array('uploadTopic_category_id', 'uploadTopic_topic_title');
	$errors = array();

	foreach($required_fields as $required_field){
		if(!isset($_POST[$required_field]) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field])))
			$errors[] = $_POST[$required_field] . ' is a required field.';
	}


	if(empty($errors) && ($_FILES['video']['error'] == 0)){

		$cid = mysql_real_escape_string((htmlspecialchars($_POST['uploadTopic_category_id'])));
		$des = mysql_real_escape_string((htmlspecialchars($_POST['uploadTopic_description'])));
		$tt = mysql_real_escape_string((htmlspecialchars($_POST['uploadTopic_topic_title'])));
		$td = mysql_real_escape_string((htmlspecialchars($_POST['uploadTopic_topic_date'])));

		if (isset($_POST['isExample'])){
			$ie = 1;
		} else {
			$ie = 0;
		}

		// $ie = mysql_real_escape_string((htmlspecialchars($_POST['isExample'])));
		$filename = $_FILES['video']['name'];
		$filetype = $_FILES['video']['type'];
		$filesize = $_FILES['video']['size'];
		$filetmpname = $_FILES['video']['tmp_name'];

		$newTopic = Topic::newTopic($cid, $des, $tt, $_SESSION['user_id'], $ie, $filename, $filesize, $filetype, $filetmpname);
		move_uploaded_file($newTopic->temp_name, "/Applications/XAMPP/xamppfiles/htdocs/ToastmasterLibrary/videos/" . $newTopic->name);		

		if($newTopic->save()){
			redirect_to("settings.php");
		} else {
			die("Cannot create topic." . mysql_error());
		}	
	} else {
		foreach($errors as $error){
			echo '</br>' . $error . '</br>';
		} 
		echo '</br>' . $_FILES['video']['error'] . '</br>';
	}
}
	

?>

<!-- Load existing values for examination -->
<!-- 
	Created a multidimensional js array. First index stores the id of the category. Second index is the array,
	with all titles associated with the specific category.
-->
<script>

	var uploadTopic_existingTitles = Array();

<?php 
	foreach($topics as $aTopic){
?>
	uploadTopic_existingTitles['<?=$aTopic->category_id?>'] = Array();
<?php
	}
?>

<?php 
	foreach($topics as $aTopic){
?>
	uploadTopic_existingTitles['<?=$aTopic->category_id?>'].push('<?=$aTopic->topic_title?>');
<?php
	}
?>
</script>

<form action="uploadTopic.php" enctype="multipart/form-data" method="post" id="uploadTopicForm">
	<legend class="formTitle">New Topic:</legend>
	<fieldset>
		<label for="uploadTopic_category_id">Category:</label>
		<select id="uploadTopic_category_id" name="uploadTopic_category_id">
			<?php
				foreach($categories as $category){
					echo "<option value=\"" . $category->id . "\">" . $category->category_title . "</option></br>";
				}
			?>
		</select>
		<label for="uploadTopic_topic_title">Topic Title:</label>
		<input class="text" id="uploadTopic_topic_title" name="uploadTopic_topic_title" type="text"/>
		<div style="color:red; font-size:12px;" class="validation"></div>
		<?php
			echo "<input id=\"topic_creator\" type=\"hidden\" name=\"topic_creator\" value=\"" . $_SESSION['user_id'] . "\"></input>";
		?>
		<label for="uploadTopic_topic_date">Date of Speech:</label>
		<input class="text" type="text" id="uploadTopic_topic_date" class="hasDatepicker" name="uploadTopic_topic_date"/>
		<div style="color:red; font-size:12px;" class="validation"></div>
		<label for="uploadTopic_description">Description:</label>
		<textarea class="text" id="uploadTopic_description" name="uploadTopic_description" placeholder="Enter a topic description:"/>
		<div style="color:red; font-size:12px;" class="validation"></div>
		Example: <input type="checkbox" id="isExample" name = "isExample"/>
		<label for="video">Select Video:</label>
		<input type="file" id="video" name="video"/>
		<input type="hidden" id="submit2" name="submit"/>
		<input id ="topicSubmitButton" name="submit" type="submit" value="submit"/>
		</fieldset>
</form>

<script>
$( '#uploadTopic_topic_date' ).datepicker();
</script>


<script>
	$( ".speechDate" ).datepicker( "show" );	

	$('#uploadTopicForm #uploadTopic_category_id').change(function(){

		var currentSelectedCategory = $(this).val();
		var topicTitle = $('#uploadTopicForm #uploadTopic_topic_title').val();
		var topicDate = $('#uploadTopicForm #uploadTopic_topic_date').val();
		var topicDescription = $('#uploadTopicForm #uploadTopic_description').val();
		// console.log(currentSelectedCategory);
		// console.log(topicTitle);
		// console.log(topicDescription);

		if(topicTitle.length == 0){
			$('#uploadTopic_topic_title').next('div[class="validation"]').text('A title is required.');
		} else if (jQuery.inArray(topicTitle, uploadTopic_existingTitles[currentSelectedCategory]) >= 0) {
			$('#uploadTopic_topic_title').next('div[class="validation"]').text('This title already exists for this manual.');
		} else {
			$('#uploadTopic_topic_title').next('div[class="validation"]').text('');	
		}

		if(topicDate.length == 0){
			$('#uploadTopic_topic_date').next('div[class="validation"]').text('A topic date is required.');
		} else {
			$('#uploadTopic_topic_date').next('div[class="validation"]').text('');	
		}

		if(topicDescription.length == 0){
			$('#uploadTopic_description').next('div[class="validation"]').text('A description is required.');
		} else {
			$('#uploadTopic_description').next('div[class="validation"]').text('');	
		}

		// $('#uploadTopic_topic_title').val('');
		// $('#uploadTopic_topic_title').next().text('');
		// $('#uploadTopic_description').val('');
		// $('#uploadTopic_description').next().text('');
		// $('#uploadTopic_topic_date').val('');
		// $('#uploadTopic_topic_date').next().text('');
	});

	$('#uploadTopicForm input, #uploadTopicForm textarea').blur(function(e){
		e.preventDefault();
		e.stopPropagation();
		var id = $(this).attr('id');
		var value = $(this).val();
		var currentSelectedCategory = $('#uploadTopicForm #uploadTopic_category_id').val();
		// console.log(id);
		// console.log(value);
		switch(id){
			case 'uploadTopic_topic_title' :
				if(value.length == 0){
					$(this).next('div[class="validation"]').text('A title is required.');
				} else if (jQuery.inArray(value, uploadTopic_existingTitles[currentSelectedCategory]) >= 0) {
					$(this).next('div[class="validation"]').text('This title already exists for this manual.');
				} else {
					$(this).next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadTopic_topic_date' :
				setTimeout(function(){
					var value = $('#uploadTopic_topic_date').val();
					// alert(value);
					if(value.length == 0){
						$('#uploadTopic_topic_date').next('div[class="validation"]').text('A topic date is required.');
					} else {
						$('#uploadTopic_topic_date').next('div[class="validation"]').text('');	
					}
				}, 30);
				break;
			case 'uploadTopic_description' :
				if(value.length == 0){
					$(this).next('div[class="validation"]').text('A description is required.');
				} else {
					$(this).next('div[class="validation"]').text('');	
				}
				break;
			default: 
				break;
		}
	});

	$('#addEditTopicsBlock').unbind();
	$('#addEditTopicsBlock').on('click','#topicSubmitButton', function(e){
		e.preventDefault();
		e.stopPropagation();
		console.log('submitbutton');
		//alert('adding topic');

		var valid = '';
		var errorDisplay = '' ;
		var required = ' is required.';
		var title = $('form[id="uploadTopicForm"] #uploadTopic_topic_title').val();
		var topic_date = $('form[id="uploadTopicForm"] #uploadTopic_topic_date').val();
		var description = $('form[id="uploadTopicForm"] #uploadTopic_description').val();
		var currentSelectedCategory = $('#uploadTopicForm #uploadTopic_category_id').val();

		console.log('title: ' + title);
		console.log('date: ' + topic_date);
		console.log('description: ' + description);
		console.log('selectedCategoryId: ' + currentSelectedCategory);

		if(title == ''){
			valid += '<p> A title is required. </p>';
			$('form[id="uploadTopicForm"] #uploadTopic_topic_title').next('div[class="validation"]').text('A title is required.');
		} else if (jQuery.inArray(title, uploadTopic_existingTitles[currentSelectedCategory]) >= 0) {
			valid += '<p> This title already exists for this manual. </p>';
			$('form[id="uploadTopicForm"] #uploadTopic_topic_title').next('div[class="validation"]').text('This title already exists for this manual.');
			console.log('here as well');
		} else {
			$('form[id="uploadTopicForm"] #uploadTopic_topic_title').next('div[class="validation"]').text('');	
		}		

		if(topic_date == ''){
			valid += '<p> A topic date is required. </p>';
			$('form[id="uploadTopicForm"] #uploadTopic_topic_date').next().text('A topic date is required.');
		} else {
			$('form[id="uploadTopicForm"] #uploadTopic_topic_date').next('div[class="validation"]').text('');	
		}
		if(description == ''){
			valid += '<p> A description is required. </p>';
			$('form[id="uploadTopicForm"] #uploadTopic_description').next().text('A description is required.');
		} else {
			$('form[id="uploadTopicForm"] #uploadTopic_description').next('div[class="validation"]').text('');	
		}

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
			$('div[class="alert alert-success"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$("#registerErrorMessages").append(errorDisplay);
			$("#registerErrorMessages").removeAttr('style');
			$("#registerErrorMessages").fadeOut(2000);
		} else {
			submitTopic();
		}
	});

	function submitTopic(){
		$('form[id="uploadTopicForm"]').ajaxSubmit({
			type:'POST',
			url: 'uploadTopic.php',
			//data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Topic added!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#topicsListingBlock").load("topicListing.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				//alert('error');
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Topic could not be deleted.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="uploadTopicForm"]')[0].reset();
			}
		});
	};
</script>